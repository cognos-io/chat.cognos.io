package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/cognos-io/chat.cognos.io/backend/internal/analytics"
	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// ConversationMessageAttachment serves the encrypted bytes of a message's
// attachment (e.g. a generated image). The messages collection is locked to
// custom routes, so the built-in protected-file endpoint denies regular users;
// this route applies the same conversation-participant access check as the rest
// of the conversation API. The bytes are ciphertext — decryption is client-side.
func ConversationMessageAttachment(params CompleteHandlerParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		owner := auth.ExtractUser(e)
		if owner == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		conversationID := e.Request.PathValue("conversationID")
		messageID := e.Request.PathValue("messageID")
		if conversationID == "" || messageID == "" {
			return apis.NewBadRequestError("Conversation and message IDs are required", nil)
		}

		// Authorise against the conversation before revealing the message exists.
		active, err := conversationAccessibleByID(e.App, conversationID, owner.ID)
		if err != nil {
			params.Logger.Error("attachment access lookup failed", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify access", err)
		}
		if !active {
			return apis.NewNotFoundError("Attachment not found", nil)
		}

		record, err := e.App.FindRecordById("messages", messageID)
		if err != nil || record.GetString("conversation") != conversationID {
			return apis.NewNotFoundError("Attachment not found", nil)
		}

		filename := record.GetString("attachment")
		if filename == "" {
			return apis.NewNotFoundError("Attachment not found", nil)
		}

		fsys, err := e.App.NewFilesystem()
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to open file storage", err)
		}
		defer fsys.Close()

		return fsys.Serve(e.Response, e.Request, record.BaseFilesPath()+"/"+filename, filename)
	}
}

type generateImageRequest struct {
	Prompt  string `json:"prompt"`
	ModelID string `json:"model_id"`
	// ParentMessageID, when set, regenerates: the new image is parented to this
	// existing message instead of creating a fresh user prompt message.
	ParentMessageID string `json:"parent_message_id,omitempty"`
	RequestID       string `json:"request_id,omitempty"`
}

const maxImagePromptChars = 4000

type imageAttachmentResponse struct {
	Kind     string `json:"kind"`
	MimeType string `json:"mime_type"`
	// FileName is the stored protected-file name on the assistant message record.
	// The client requests a file token and fetches it, then decrypts client-side.
	FileName string `json:"file_name"`
	// SealedKey is the per-attachment symmetric key sealed to the conversation
	// public key (base64). It is useless without the conversation secret key, so
	// returning it lets the client decrypt the just-generated image immediately
	// without re-fetching the encrypted message.
	SealedKey string `json:"sealed_key"`
}

type assistantImageMessageResponse struct {
	ID              string                  `json:"id"`
	ParentMessageID string                  `json:"parent_message_id,omitempty"`
	ModelID         string                  `json:"model_id"`
	CreatedAt       string                  `json:"created_at"`
	Attachment      imageAttachmentResponse `json:"attachment"`
}

type generateImageResponse struct {
	RequestID        string                        `json:"request_id,omitempty"`
	UserMessageID    string                        `json:"user_message_id,omitempty"`
	AssistantMessage assistantImageMessageResponse `json:"assistant_message"`
	Usage            usageResponse                 `json:"usage"`
}

// GenerateConversationImage handles POST /api/v1/conversations/{id}/image. It
// generates an image with the selected model, encrypts the bytes for the
// conversation, and persists them as a protected attachment on an encrypted
// assistant message. Capability, privacy-tier and billing are all enforced
// server-side before the provider is called, mirroring the completion pipeline.
func GenerateConversationImage(params CompleteHandlerParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		owner := auth.ExtractUser(e)
		if owner == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		var req generateImageRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}

		req.Prompt = strings.TrimSpace(req.Prompt)
		req.ModelID = strings.TrimSpace(req.ModelID)
		req.RequestID = strings.TrimSpace(req.RequestID)
		req.ParentMessageID = strings.TrimSpace(req.ParentMessageID)

		if req.ModelID == "" {
			return apis.NewBadRequestError("Model ID is required", nil)
		}
		if req.Prompt == "" {
			return apis.NewBadRequestError("Prompt is required", nil)
		}
		if len(req.Prompt) > maxImagePromptChars {
			return apis.NewBadRequestError("Prompt is too long", nil)
		}

		model, ok, err := params.CatalogueService.GetModelByID(context.Background(), req.ModelID)
		if err != nil {
			params.Logger.Error("catalogue lookup failed", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load model", err)
		}
		if !ok || !model.IsActive {
			return apis.NewBadRequestError("Invalid model ID", nil)
		}

		// Capability enforcement: a client cannot bypass the UI and ask a
		// text-only model to generate an image.
		if !model.SupportsImageGeneration {
			return apis.NewBadRequestError("Model does not support image generation", nil)
		}

		userTier := catalogue.NormalizePrivacyTier(e.Auth.GetString("privacy_tier"))
		if !catalogue.IsEligibleForTier(userTier, model.PrivacyTier) {
			return apis.NewForbiddenError("Model is not available for the user's privacy tier", nil)
		}

		conversationID := e.Request.PathValue("conversationID")
		if conversationID == "" {
			return apis.NewBadRequestError("Conversation ID is required", nil)
		}

		// Authorise against the conversation before revealing it exists.
		if params.App != nil {
			active, err := conversationAccessibleByID(params.App, conversationID, owner.ID)
			if err != nil {
				params.Logger.Error("conversation access lookup failed", "err", err)
				return apis.NewApiError(http.StatusInternalServerError, "Failed to verify conversation access", err)
			}
			if !active {
				return apis.NewNotFoundError("Conversation not found or unable to load", nil)
			}
		}

		conversation, err := params.ConversationRepo.ByID(conversationID)
		if err != nil {
			return apis.NewNotFoundError("Conversation not found or unable to load", err)
		}

		usdToCHFRate := completionUSDToCHFRate(params)

		// Billing gate: block before any paid provider request.
		var billingState *billing.State
		if params.BillingStateRepo != nil && params.BillingService != nil {
			state, err := params.BillingStateRepo.StateForUser(owner.ID)
			if err != nil {
				if !errors.Is(err, billing.ErrStateNotFound) {
					params.Logger.Error("billing state lookup failed", "err", err)
					return apis.NewApiError(http.StatusInternalServerError, "Failed to evaluate billing access", err)
				}
			} else {
				estimatedCost := params.BillingService.EstimateUpperBoundCost(model, 0, usdToCHFRate)
				if restriction := params.BillingService.EvaluateAccess(state, estimatedCost.CostMicroRappen); restriction != nil {
					return e.JSON(http.StatusPaymentRequired, restriction)
				}
				billingState = &state
			}
		}

		// Regenerate mode: parent the new image to an existing prompt message
		// instead of creating a fresh one (mirrors the text regenerate path).
		regenerate := req.ParentMessageID != ""
		var userMessageRecord *core.Record
		assistantParentID := req.ParentMessageID

		if regenerate {
			parentRecord, err := e.App.FindRecordById("messages", req.ParentMessageID)
			if err != nil || parentRecord.GetString("conversation") != conversationID {
				return apis.NewNotFoundError("Parent message not found or unable to load", nil)
			}
		} else {
			// Persist the user's prompt as a user message first, so the prompt and
			// its generated image stay together in the conversation thread.
			persistErr, record := params.MessageRepo.EncryptAndPersistMessage(
				conversation,
				"",
				chat.MessageRecordData{
					OwnerID:   owner.ID,
					Content:   req.Prompt,
					CreatedAt: time.Now().UTC().Format(time.RFC3339),
				},
			)
			if persistErr != nil {
				params.Logger.Error("failed to save image prompt message", "err", persistErr)
				return apis.NewApiError(http.StatusInternalServerError, "Failed to save request message", persistErr)
			}
			userMessageRecord = record
			assistantParentID = record.Id
		}

		// cleanupPromptMessage rolls back the freshly-persisted prompt on a later
		// failure. No-op when regenerating (we created no prompt message).
		cleanupPromptMessage := func() {
			if userMessageRecord != nil {
				if deleteErr := params.MessageRepo.DeleteMessage(userMessageRecord.Id); deleteErr != nil {
					params.Logger.Error("failed to clean up image prompt message", "err", deleteErr)
				}
			}
		}

		gatewayStartedAt := time.Now()
		imageResp, err := params.GatewayClient.GenerateImage(e.Request.Context(), gateway.ImageRequest{
			ProviderID:      model.ProviderID,
			ProviderModelID: model.ProviderModelID,
			Prompt:          req.Prompt,
			Transport:       gateway.ImageTransport(model.ImageGenerationTransport),
			OutputFormat:    "png",
		})
		if err != nil || len(imageResp.Images) == 0 || len(imageResp.Images[0].Bytes) == 0 {
			cleanupPromptMessage()
			params.Logger.Error("image generation upstream request failed", "provider", model.ProviderID, "err", err)
			return apis.NewApiError(http.StatusServiceUnavailable, "Failed to generate image", nil)
		}

		image := imageResp.Images[0]

		// Encrypt the image bytes for the conversation before any durable write.
		attachment, err := chat.EncryptAttachment(image.Bytes, conversation.PublicKey)
		if err != nil {
			cleanupPromptMessage()
			params.Logger.Error("failed to encrypt generated image", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to store generated image", nil)
		}

		assistantCreatedAt := time.Now().UTC().Format(time.RFC3339)
		err, assistantMessageRecord := params.MessageRepo.EncryptAndPersistImageMessage(
			conversation,
			assistantParentID,
			chat.MessageRecordData{
				ModelID:   model.ID,
				CreatedAt: assistantCreatedAt,
				Attachments: []chat.MessageAttachment{{
					Kind:      "generated_image",
					MimeType:  image.MimeType,
					SealedKey: attachment.SealedKeyB64,
				}},
			},
			attachment.Ciphertext,
		)
		if err != nil {
			cleanupPromptMessage()
			params.Logger.Error("failed to save generated image message", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to store generated image", nil)
		}

		costBreakdown := params.BillingService.CalculateCost(model, billing.Usage{
			InputTokens:     imageResp.Usage.InputTokens,
			OutputTokens:    imageResp.Usage.OutputTokens,
			ProviderCostUSD: imageResp.Usage.ProviderCostUSD,
		}, usdToCHFRate)

		eventID := uuid.NewString()
		if billingState != nil {
			if params.BillingLedgerRepo != nil {
				usageRecord := params.BillingService.BuildUsageRecord(*billingState, billing.BuildUsageRecordInput{
					UserID:              owner.ID,
					EventID:             eventID,
					ModelID:             model.ID,
					Cost:                costBreakdown,
					FXRateUSDCHF:        usdToCHFRate,
					InputTokens:         imageResp.Usage.InputTokens,
					OutputTokens:        imageResp.Usage.OutputTokens,
					OperationType:       billing.OperationTypeImageGeneration,
					GeneratedImageCount: int64(len(imageResp.Images)),
				})
				if err := params.BillingLedgerRepo.RecordUsage(usageRecord); err != nil {
					params.Logger.Error("failed to record image billing usage", "err", err)
				}
			}

			if params.UsageEmitter != nil {
				billingUserID := billingState.BillingUserID
				if billingUserID == "" {
					billingUserID = owner.ID
				}
				usageEvent := analytics.BuildUsageEvent(analytics.BuildUsageEventInput{
					EventID:       eventID,
					OccurredAt:    time.Now().UTC(),
					BillingUserID: billingUserID,
					PlanType:      billingState.PlanType,
					Model:         model,
					PrivacyTier:   userTier,
					Cost:          costBreakdown,
					FXRateUSDCHF:  usdToCHFRate,
					LatencyMS:     time.Since(gatewayStartedAt).Milliseconds(),
				})
				if err := params.UsageEmitter.Emit(usageEvent); err != nil {
					params.Logger.Error("failed to emit image analytics usage event", "err", err)
				}
			}
		}

		if params.ConversationRepo != nil {
			if err := params.ConversationRepo.SetConversationUpdated(conversationID); err != nil {
				params.Logger.Error("failed to bump conversation updated time", "err", err)
			}
		}

		userMessageID := ""
		if userMessageRecord != nil {
			userMessageID = userMessageRecord.Id
		}

		return e.JSON(http.StatusOK, generateImageResponse{
			RequestID:     req.RequestID,
			UserMessageID: userMessageID,
			AssistantMessage: assistantImageMessageResponse{
				ID:              assistantMessageRecord.Id,
				ParentMessageID: assistantParentID,
				ModelID:         model.ID,
				CreatedAt:       assistantCreatedAt,
				Attachment: imageAttachmentResponse{
					Kind:      "generated_image",
					MimeType:  image.MimeType,
					FileName:  assistantMessageRecord.GetString("attachment"),
					SealedKey: attachment.SealedKeyB64,
				},
			},
			Usage: usageResponse{
				InputTokens:      imageResp.Usage.InputTokens,
				OutputTokens:     imageResp.Usage.OutputTokens,
				TotalTokens:      imageResp.Usage.TotalTokens,
				CostUSD:          costBreakdown.CostUSD,
				CostCHF:          costBreakdown.CostCHF,
				CostRappen:       costBreakdown.CostRappen,
				UsedProviderCost: costBreakdown.UsedProviderCost,
			},
		})
	}
}
