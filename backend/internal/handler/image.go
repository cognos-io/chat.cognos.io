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

type generateImageRequest struct {
	Prompt    string `json:"prompt"`
	ModelID   string `json:"model_id"`
	RequestID string `json:"request_id,omitempty"`
}

const maxImagePromptChars = 4000

type imageAttachmentResponse struct {
	Kind     string `json:"kind"`
	MimeType string `json:"mime_type"`
	// FileName is the stored protected-file name on the assistant message record.
	// The client requests a file token and fetches it, then decrypts client-side.
	FileName string `json:"file_name"`
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

		// Persist the user's prompt as a user message first, so the prompt and
		// its generated image stay together in the conversation thread.
		err, userMessageRecord := params.MessageRepo.EncryptAndPersistMessage(
			conversation,
			"",
			chat.MessageRecordData{
				OwnerID:   owner.ID,
				Content:   req.Prompt,
				CreatedAt: time.Now().UTC().Format(time.RFC3339),
			},
		)
		if err != nil {
			params.Logger.Error("failed to save image prompt message", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to save request message", err)
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
			// Roll back the orphaned prompt message, mirroring the completion path.
			if deleteErr := params.MessageRepo.DeleteMessage(userMessageRecord.Id); deleteErr != nil {
				params.Logger.Error("failed to clean up image prompt message", "err", deleteErr)
			}
			params.Logger.Error("image generation upstream request failed", "provider", model.ProviderID, "err", err)
			return apis.NewApiError(http.StatusServiceUnavailable, "Failed to generate image", nil)
		}

		image := imageResp.Images[0]

		// Encrypt the image bytes for the conversation before any durable write.
		attachment, err := chat.EncryptAttachment(image.Bytes, conversation.PublicKey)
		if err != nil {
			if deleteErr := params.MessageRepo.DeleteMessage(userMessageRecord.Id); deleteErr != nil {
				params.Logger.Error("failed to clean up image prompt message", "err", deleteErr)
			}
			params.Logger.Error("failed to encrypt generated image", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to store generated image", nil)
		}

		assistantCreatedAt := time.Now().UTC().Format(time.RFC3339)
		err, assistantMessageRecord := params.MessageRepo.EncryptAndPersistImageMessage(
			conversation,
			userMessageRecord.Id,
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
			if deleteErr := params.MessageRepo.DeleteMessage(userMessageRecord.Id); deleteErr != nil {
				params.Logger.Error("failed to clean up image prompt message", "err", deleteErr)
			}
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

		return e.JSON(http.StatusOK, generateImageResponse{
			RequestID:     req.RequestID,
			UserMessageID: userMessageRecord.Id,
			AssistantMessage: assistantImageMessageResponse{
				ID:              assistantMessageRecord.Id,
				ParentMessageID: userMessageRecord.Id,
				ModelID:         model.ID,
				CreatedAt:       assistantCreatedAt,
				Attachment: imageAttachmentResponse{
					Kind:     "generated_image",
					MimeType: image.MimeType,
					FileName: assistantMessageRecord.GetString("attachment"),
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
