package handler

import (
	"context"
	"encoding/base64"
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
	// Messages is the prior conversation context (oldest-first, redacted
	// plaintext) the client sends so a chat-transport image model keeps context.
	// The current prompt is the last user message. Optional: an empty list falls
	// back to sending just Prompt. Never persisted — forwarded to the provider
	// only, exactly like the completion endpoint's messages.
	Messages []completionMessage `json:"messages,omitempty"`
	// ParentMessageID, when set, regenerates: the new image is parented to this
	// existing message instead of creating a fresh user prompt message. Only
	// meaningful on the conversation-scoped endpoint; ignored by the stateless
	// (temporary-chat) endpoint, which persists nothing.
	ParentMessageID string `json:"parent_message_id,omitempty"`
	// PromptParentMessageID, when set on a fresh generation, parents the newly
	// persisted user prompt to the current active-branch leaf. This keeps a
	// text conversation followed by image generation in one reloadable thread.
	PromptParentMessageID string `json:"prompt_parent_message_id,omitempty"`
	RequestID             string `json:"request_id,omitempty"`
}

const maxImagePromptChars = 4000

const (
	// imageKindPersisted marks a generated image that was encrypted and stored as
	// a conversation attachment; the client fetches the file and decrypts it.
	imageKindPersisted = "generated_image"
	// imageKindInline marks a generated image returned inline as base64 in the
	// response body (temporary chats). Nothing is stored server-side; the client
	// renders the bytes directly.
	imageKindInline = "inline_image"
)

type imageAttachmentResponse struct {
	Kind     string `json:"kind"`
	MimeType string `json:"mime_type"`
	// FileName is the stored protected-file name on the assistant message record
	// (persisted path only). The client requests a file token and fetches it,
	// then decrypts client-side.
	FileName string `json:"file_name,omitempty"`
	// SealedKey is the per-attachment symmetric key sealed to the conversation
	// public key (base64, persisted path only). It is useless without the
	// conversation secret key, so returning it lets the client decrypt the
	// just-generated image immediately without re-fetching the encrypted message.
	SealedKey string `json:"sealed_key,omitempty"`
	// DataBase64 is the raw image bytes, base64-encoded, for the inline
	// (temporary-chat) path. Never stored server-side. Populated only when
	// Kind == imageKindInline.
	DataBase64 string `json:"data_base64,omitempty"`
}

type assistantImageMessageResponse struct {
	ID              string `json:"id,omitempty"`
	ParentMessageID string `json:"parent_message_id,omitempty"`
	ModelID         string `json:"model_id"`
	CreatedAt       string `json:"created_at"`
	// Attachment carries the generated image. Nil when the model answered with
	// text instead — in that case Content holds the reply and the client renders
	// it as a normal assistant message.
	Attachment *imageAttachmentResponse `json:"attachment,omitempty"`
	// Content is the assistant's text reply for the text-fallback path. Empty
	// when an image was generated.
	Content string `json:"content,omitempty"`
}

type generateImageResponse struct {
	RequestID        string                        `json:"request_id,omitempty"`
	UserMessageID    string                        `json:"user_message_id,omitempty"`
	AssistantMessage assistantImageMessageResponse `json:"assistant_message"`
	Usage            usageResponse                 `json:"usage"`
}

// imageRequestContext carries the authenticated caller and the validated request
// and model shared by the conversation-scoped and stateless image handlers.
type imageRequestContext struct {
	owner    *auth.User
	req      generateImageRequest
	model    catalogue.Model
	userTier catalogue.PrivacyTier
}

// resolveImageRequest authenticates the caller, binds and validates the request,
// and loads the target model with its capability and privacy-tier checks. It is
// identical for the conversation and stateless image paths; any returned error
// is already an API error safe to return directly from the handler.
func resolveImageRequest(
	e *core.RequestEvent,
	params CompleteHandlerParams,
) (imageRequestContext, error) {
	owner := auth.ExtractUser(e)
	if owner == nil {
		return imageRequestContext{}, apis.NewUnauthorizedError("User not authenticated", nil)
	}

	var req generateImageRequest
	if err := e.BindBody(&req); err != nil {
		return imageRequestContext{}, apis.NewBadRequestError("Failed to read request data", err)
	}

	req.Prompt = strings.TrimSpace(req.Prompt)
	req.ModelID = strings.TrimSpace(req.ModelID)
	req.RequestID = strings.TrimSpace(req.RequestID)
	req.ParentMessageID = strings.TrimSpace(req.ParentMessageID)
	req.PromptParentMessageID = strings.TrimSpace(req.PromptParentMessageID)

	if req.ModelID == "" {
		return imageRequestContext{}, apis.NewBadRequestError("Model ID is required", nil)
	}
	if req.Prompt == "" {
		return imageRequestContext{}, apis.NewBadRequestError("Prompt is required", nil)
	}
	if len(req.Prompt) > maxImagePromptChars {
		return imageRequestContext{}, apis.NewBadRequestError("Prompt is too long", nil)
	}

	model, ok, err := params.CatalogueService.GetModelByID(context.Background(), req.ModelID)
	if err != nil {
		params.Logger.Error("catalogue lookup failed", "err", err)
		return imageRequestContext{}, apis.NewApiError(http.StatusInternalServerError, "Failed to load model", err)
	}
	if !ok || !model.IsActive {
		return imageRequestContext{}, apis.NewBadRequestError("Invalid model ID", nil)
	}

	// Capability enforcement: a client cannot bypass the UI and ask a
	// text-only model to generate an image.
	if !model.SupportsImageGeneration {
		return imageRequestContext{}, apis.NewBadRequestError("Model does not support image generation", nil)
	}

	userTier := catalogue.NormalizePrivacyTier(e.Auth.GetString("privacy_tier"))
	if !catalogue.IsEligibleForTier(userTier, model.PrivacyTier) {
		return imageRequestContext{}, apis.NewForbiddenError("Model is not available for the user's privacy tier", nil)
	}

	return imageRequestContext{owner: owner, req: req, model: model, userTier: userTier}, nil
}

// imageBillingGate resolves the billing subject for the request (personal, or
// the Organisation when the conversation lives in an org-owned Project) and
// blocks before any paid provider request when the subject cannot pay. It
// returns a nil resolved state (charge nothing, but proceed) when billing is
// not configured or the user has no billing state yet, mirroring the
// completion pipeline. When the subject is blocked it returns a non-nil
// restriction the handler must send as a 402 — already mapped to the same
// wire shape the completion endpoint uses so clients parse one 402 contract.
// A non-nil error is a real failure to return directly.
//
// conversationID must be a conversation the caller's access to which has
// already been verified — the stateless path passes "" and always bills
// personally.
func imageBillingGate(
	params CompleteHandlerParams,
	ownerID string,
	conversationID string,
	model catalogue.Model,
	usdToCHFRate float64,
) (*billing.ResolvedState, *CompleteBillingRestriction, error) {
	if params.BillingStateRepo == nil || params.BillingService == nil {
		return nil, nil, nil
	}

	resolved, err := billing.ResolveState(params.BillingStateRepo, ownerID, conversationID)
	if err != nil {
		if errors.Is(err, billing.ErrStateNotFound) {
			return nil, nil, nil
		}
		params.Logger.Error("billing state lookup failed", "err", err)
		return nil, nil, apis.NewApiError(http.StatusInternalServerError, "Failed to evaluate billing access", err)
	}

	// Org subjects fail closed BEFORE any provider work — a lapsed org never
	// falls back to the member's personal balance (spec
	// docs/specs/organisations.md §7.5).
	if restriction := params.BillingService.EvaluateOrgAccess(resolved); restriction != nil {
		response := completeBillingRestrictionResponse(*restriction, 0)
		return nil, &response, nil
	}

	estimatedCost := params.BillingService.EstimateUpperBoundCost(model, 0, usdToCHFRate)
	if restriction := params.BillingService.EvaluateAccess(resolved.State, estimatedCost.CostMicroRappen); restriction != nil {
		response := completeBillingRestrictionResponse(*restriction, estimatedCost.CostCHF)
		return nil, &response, nil
	}

	return &resolved, nil, nil
}

// callImageGateway issues the provider image request for a resolved model.
func callImageGateway(
	ctx context.Context,
	params CompleteHandlerParams,
	model catalogue.Model,
	req generateImageRequest,
) (gateway.ImageResponse, error) {
	return params.GatewayClient.GenerateImage(ctx, gateway.ImageRequest{
		ProviderID:      model.ProviderID,
		ProviderModelID: model.ProviderModelID,
		Prompt:          req.Prompt,
		Messages:        imageChatHistory(req),
		Transport:       gateway.ImageTransport(model.ImageGenerationTransport),
		OutputFormat:    "png",
	})
}

// recordImageUsageInput carries everything recordImageUsage needs to price and
// record a completed image request.
type recordImageUsageInput struct {
	billingResolved     *billing.ResolvedState
	ownerID             string
	model               catalogue.Model
	userTier            catalogue.PrivacyTier
	usage               gateway.Usage
	usdToCHFRate        float64
	operationType       billing.OperationType
	generatedImageCount int64
	gatewayStartedAt    time.Time
}

// recordImageUsage prices a completed image request and writes the billing
// ledger row and analytics usage event, sharing one event id between them. It is
// a no-op ledger/analytics-wise when billing is not configured (nil state, e.g.
// tests or an unbilled deployment), but always returns the cost breakdown for
// the response payload. This is the single post-provider billing path shared by
// the conversation and stateless image handlers and the text-fallback path, so
// image gen is charged identically whether or not the result was persisted.
func recordImageUsage(params CompleteHandlerParams, in recordImageUsageInput) billing.CostBreakdown {
	if params.BillingService == nil {
		return billing.CostBreakdown{}
	}

	costBreakdown := params.BillingService.CalculateCost(in.model, billing.Usage{
		InputTokens:     in.usage.InputTokens,
		OutputTokens:    in.usage.OutputTokens,
		ProviderCostUSD: in.usage.ProviderCostUSD,
	}, in.usdToCHFRate)

	if in.billingResolved == nil {
		return costBreakdown
	}

	eventID := uuid.NewString()
	if params.BillingLedgerRepo != nil {
		usageRecord := params.BillingService.BuildUsageRecord(in.billingResolved.State, billing.BuildUsageRecordInput{
			UserID: in.ownerID,
			// Org-owned Project scope settles against the org's pooled
			// cycle; UserID above stays the acting Account.
			OrganisationID:      in.billingResolved.Subject.OrganisationID(),
			EventID:             eventID,
			ModelID:             in.model.ID,
			Cost:                costBreakdown,
			FXRateUSDCHF:        in.usdToCHFRate,
			InputTokens:         in.usage.InputTokens,
			OutputTokens:        in.usage.OutputTokens,
			OperationType:       in.operationType,
			GeneratedImageCount: in.generatedImageCount,
		})
		if err := params.BillingLedgerRepo.RecordUsage(usageRecord); err != nil {
			params.Logger.Error("failed to record image billing usage", "err", err)
		}
	}

	if params.UsageEmitter != nil {
		billingUserID := in.billingResolved.State.BillingUserID
		if billingUserID == "" {
			billingUserID = in.ownerID
		}
		usageEvent := analytics.BuildUsageEvent(analytics.BuildUsageEventInput{
			EventID:       eventID,
			OccurredAt:    time.Now().UTC(),
			BillingUserID: billingUserID,
			PlanType:      in.billingResolved.State.PlanType,
			Model:         in.model,
			PrivacyTier:   in.userTier,
			Cost:          costBreakdown,
			FXRateUSDCHF:  in.usdToCHFRate,
			LatencyMS:     time.Since(in.gatewayStartedAt).Milliseconds(),
		})
		if err := params.UsageEmitter.Emit(usageEvent); err != nil {
			params.Logger.Error("failed to emit image analytics usage event", "err", err)
		}
	}

	return costBreakdown
}

// imageUsageResponse projects a gateway usage + billing cost onto the wire shape.
func imageUsageResponse(usage gateway.Usage, cost billing.CostBreakdown) usageResponse {
	return usageResponse{
		InputTokens:      usage.InputTokens,
		OutputTokens:     usage.OutputTokens,
		TotalTokens:      usage.TotalTokens,
		CostUSD:          cost.CostUSD,
		CostCHF:          cost.CostCHF,
		CostRappen:       cost.CostRappen,
		UsedProviderCost: cost.UsedProviderCost,
	}
}

// GenerateConversationImage handles POST /api/v1/conversations/{id}/image. It
// generates an image with the selected model, encrypts the bytes for the
// conversation, and persists them as a protected attachment on an encrypted
// assistant message. Capability, privacy-tier and billing are all enforced
// server-side before the provider is called, mirroring the completion pipeline.
func GenerateConversationImage(params CompleteHandlerParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		ctx, err := resolveImageRequest(e, params)
		if err != nil {
			return err
		}
		owner, req, model, userTier := ctx.owner, ctx.req, ctx.model, ctx.userTier

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

		// Billing gate: block before any paid provider request. The
		// conversation's access was verified above, so it may resolve the
		// billing subject (an org-owned Project bills the Organisation).
		billingResolved, restriction, err := imageBillingGate(params, owner.ID, conversationID, model, usdToCHFRate)
		if err != nil {
			return err
		}
		if restriction != nil {
			return e.JSON(http.StatusPaymentRequired, restriction)
		}

		// Regenerate mode: parent the new image to an existing prompt message
		// instead of creating a fresh one (mirrors the text regenerate path).
		if req.ParentMessageID != "" && req.PromptParentMessageID != "" {
			return apis.NewBadRequestError("Use either parent_message_id or prompt_parent_message_id, not both", nil)
		}

		regenerate := req.ParentMessageID != ""
		var userMessageRecord *core.Record
		assistantParentID := req.ParentMessageID

		if regenerate {
			parentRecord, err := e.App.FindRecordById("messages", req.ParentMessageID)
			if err != nil || parentRecord.GetString("conversation") != conversationID {
				return apis.NewNotFoundError("Parent message not found or unable to load", nil)
			}
		} else {
			if req.PromptParentMessageID != "" {
				parentRecord, err := e.App.FindRecordById("messages", req.PromptParentMessageID)
				if err != nil || parentRecord.GetString("conversation") != conversationID {
					return apis.NewNotFoundError("Prompt parent message not found or unable to load", nil)
				}
			}
			// Persist the user's prompt as a user message first, so the prompt and
			// its generated image stay together in the conversation thread.
			persistErr, record := params.MessageRepo.EncryptAndPersistMessage(
				conversation,
				req.PromptParentMessageID,
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
		imageResp, err := callImageGateway(e.Request.Context(), params, model, req)
		if err != nil {
			cleanupPromptMessage()
			params.Logger.Error("image generation upstream request failed", "provider", model.ProviderID, "err", err)
			return apis.NewApiError(http.StatusServiceUnavailable, "Failed to generate image", nil)
		}

		hasImage := len(imageResp.Images) > 0 && len(imageResp.Images[0].Bytes) > 0

		// Text fallback: the model answered with words instead of an image (a
		// refusal, a clarifying question, or a description). Persist it as a
		// normal text assistant message rather than failing the request.
		if !hasImage {
			if strings.TrimSpace(imageResp.Text) == "" {
				cleanupPromptMessage()
				params.Logger.Error("image generation returned no image or text", "provider", model.ProviderID)
				return apis.NewApiError(http.StatusServiceUnavailable, "Failed to generate image", nil)
			}
			return respondImageTextFallback(e, imageTextFallback{
				params:            params,
				conversation:      conversation,
				conversationID:    conversationID,
				model:             model,
				text:              imageResp.Text,
				usage:             imageResp.Usage,
				assistantParentID: assistantParentID,
				userMessageRecord: userMessageRecord,
				ownerID:           owner.ID,
				requestID:         req.RequestID,
				usdToCHFRate:      usdToCHFRate,
				billingResolved:   billingResolved,
				userTier:          userTier,
				gatewayStartedAt:  gatewayStartedAt,
				cleanup:           cleanupPromptMessage,
			})
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
				ModelID:     model.ID,
				ServedModel: servedModelSnapshot(model),
				CreatedAt:   assistantCreatedAt,
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

		// Exactly one image is persisted and returned, so the ledger records a
		// count of 1 (GeneratedImageCount is reconciliation metadata, not a cost
		// multiplier — cost comes from provider/token pricing).
		costBreakdown := recordImageUsage(params, recordImageUsageInput{
			billingResolved:     billingResolved,
			ownerID:             owner.ID,
			model:               model,
			userTier:            userTier,
			usage:               imageResp.Usage,
			usdToCHFRate:        usdToCHFRate,
			operationType:       billing.OperationTypeImageGeneration,
			generatedImageCount: 1,
			gatewayStartedAt:    gatewayStartedAt,
		})

		if params.ConversationRepo != nil {
			if err := params.ConversationRepo.BumpActivity(conversationID, chat.ActivityMessageCreated); err != nil {
				params.Logger.Error("failed to bump conversation activity time", "err", err)
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
				Attachment: &imageAttachmentResponse{
					Kind:      imageKindPersisted,
					MimeType:  image.MimeType,
					FileName:  assistantMessageRecord.GetString("attachment"),
					SealedKey: attachment.SealedKeyB64,
				},
			},
			Usage: imageUsageResponse(imageResp.Usage, costBreakdown),
		})
	}
}

// GenerateImage handles POST /api/v1/images, the stateless (temporary-chat)
// counterpart of GenerateConversationImage. It generates an image and returns
// the bytes inline as base64 — nothing is stored server-side (there is no
// conversation to encrypt to), mirroring how temporary text completions stream
// plaintext that is never persisted. Capability, privacy-tier and billing are
// enforced identically to the conversation path, so image generation is charged
// in temporary chats even though no message is saved.
func GenerateImage(params CompleteHandlerParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		ctx, err := resolveImageRequest(e, params)
		if err != nil {
			return err
		}
		owner, req, model, userTier := ctx.owner, ctx.req, ctx.model, ctx.userTier

		usdToCHFRate := completionUSDToCHFRate(params)

		// Billing gate: block before any paid provider request. Charging is
		// independent of persistence — a temporary chat persists nothing but is
		// still billed for the provider call. There is no conversation, so the
		// subject is always the caller personally.
		billingResolved, restriction, err := imageBillingGate(params, owner.ID, "", model, usdToCHFRate)
		if err != nil {
			return err
		}
		if restriction != nil {
			return e.JSON(http.StatusPaymentRequired, restriction)
		}

		gatewayStartedAt := time.Now()
		imageResp, err := callImageGateway(e.Request.Context(), params, model, req)
		if err != nil {
			params.Logger.Error("image generation upstream request failed", "provider", model.ProviderID, "err", err)
			return apis.NewApiError(http.StatusServiceUnavailable, "Failed to generate image", nil)
		}

		hasImage := len(imageResp.Images) > 0 && len(imageResp.Images[0].Bytes) > 0

		createdAt := time.Now().UTC().Format(time.RFC3339)

		// Text fallback: the model answered with words instead of an image. Bill
		// it as a text turn and return the reply inline; nothing is persisted.
		if !hasImage {
			if strings.TrimSpace(imageResp.Text) == "" {
				params.Logger.Error("image generation returned no image or text", "provider", model.ProviderID)
				return apis.NewApiError(http.StatusServiceUnavailable, "Failed to generate image", nil)
			}
			costBreakdown := recordImageUsage(params, recordImageUsageInput{
				billingResolved:  billingResolved,
				ownerID:          owner.ID,
				model:            model,
				userTier:         userTier,
				usage:            imageResp.Usage,
				usdToCHFRate:     usdToCHFRate,
				operationType:    billing.OperationTypeText,
				gatewayStartedAt: gatewayStartedAt,
			})
			return e.JSON(http.StatusOK, generateImageResponse{
				RequestID: req.RequestID,
				AssistantMessage: assistantImageMessageResponse{
					ModelID:   model.ID,
					CreatedAt: createdAt,
					Content:   imageResp.Text,
				},
				Usage: imageUsageResponse(imageResp.Usage, costBreakdown),
			})
		}

		image := imageResp.Images[0]

		costBreakdown := recordImageUsage(params, recordImageUsageInput{
			billingResolved:     billingResolved,
			ownerID:             owner.ID,
			model:               model,
			userTier:            userTier,
			usage:               imageResp.Usage,
			usdToCHFRate:        usdToCHFRate,
			operationType:       billing.OperationTypeImageGeneration,
			generatedImageCount: 1,
			gatewayStartedAt:    gatewayStartedAt,
		})

		return e.JSON(http.StatusOK, generateImageResponse{
			RequestID: req.RequestID,
			AssistantMessage: assistantImageMessageResponse{
				ModelID:   model.ID,
				CreatedAt: createdAt,
				Attachment: &imageAttachmentResponse{
					Kind:       imageKindInline,
					MimeType:   image.MimeType,
					DataBase64: base64.StdEncoding.EncodeToString(image.Bytes),
				},
			},
			Usage: imageUsageResponse(imageResp.Usage, costBreakdown),
		})
	}
}

// imageChatHistory maps the client-sent conversation context onto gateway
// messages so a chat-transport image model keeps context. Returns nil when no
// history was sent, letting the gateway fall back to a single prompt message.
// Never persisted — forwarded to the provider only, like completion messages.
func imageChatHistory(req generateImageRequest) []gateway.Message {
	if len(req.Messages) == 0 {
		return nil
	}
	messages := make([]gateway.Message, 0, len(req.Messages))
	for _, msg := range req.Messages {
		messages = append(messages, gateway.Message{
			Role:    msg.Role,
			Content: msg.Content,
			Name:    msg.Name,
		})
	}
	return messages
}

// imageTextFallback carries what respondImageTextFallback needs to persist a
// text reply an image model returned instead of an image.
type imageTextFallback struct {
	params            CompleteHandlerParams
	conversation      chat.Conversation
	conversationID    string
	model             catalogue.Model
	text              string
	usage             gateway.Usage
	assistantParentID string
	userMessageRecord *core.Record
	ownerID           string
	requestID         string
	usdToCHFRate      float64
	billingResolved   *billing.ResolvedState
	userTier          catalogue.PrivacyTier
	gatewayStartedAt  time.Time
	cleanup           func()
}

// respondImageTextFallback persists the model's text reply as a normal encrypted
// assistant message, bills it as a text turn, and returns the text response. It
// mirrors the completion pipeline's post-provider bookkeeping (billing,
// analytics, activity bump) so a text answer to an image request behaves like an
// ordinary assistant turn the user can continue from.
func respondImageTextFallback(e *core.RequestEvent, f imageTextFallback) error {
	params := f.params

	assistantCreatedAt := time.Now().UTC().Format(time.RFC3339)
	err, assistantMessageRecord := params.MessageRepo.EncryptAndPersistMessage(
		f.conversation,
		f.assistantParentID,
		chat.MessageRecordData{
			ModelID:      f.model.ID,
			ServedModel:  servedModelSnapshot(f.model),
			Content:      f.text,
			CreatedAt:    assistantCreatedAt,
			InputTokens:  f.usage.InputTokens,
			OutputTokens: f.usage.OutputTokens,
		},
	)
	if err != nil {
		f.cleanup()
		params.Logger.Error("failed to save image text-fallback message", "err", err)
		return apis.NewApiError(http.StatusInternalServerError, "Failed to store response", nil)
	}

	// A text reply is billed as a text turn, not an image (no image was
	// produced), so GeneratedImageCount stays 0.
	costBreakdown := recordImageUsage(params, recordImageUsageInput{
		billingResolved:  f.billingResolved,
		ownerID:          f.ownerID,
		model:            f.model,
		userTier:         f.userTier,
		usage:            f.usage,
		usdToCHFRate:     f.usdToCHFRate,
		operationType:    billing.OperationTypeText,
		gatewayStartedAt: f.gatewayStartedAt,
	})

	if params.ConversationRepo != nil {
		if err := params.ConversationRepo.BumpActivity(f.conversationID, chat.ActivityMessageCreated); err != nil {
			params.Logger.Error("failed to bump conversation activity time", "err", err)
		}
	}

	userMessageID := ""
	if f.userMessageRecord != nil {
		userMessageID = f.userMessageRecord.Id
	}

	return e.JSON(http.StatusOK, generateImageResponse{
		RequestID:     f.requestID,
		UserMessageID: userMessageID,
		AssistantMessage: assistantImageMessageResponse{
			ID:              assistantMessageRecord.Id,
			ParentMessageID: f.assistantParentID,
			ModelID:         f.model.ID,
			CreatedAt:       assistantCreatedAt,
			Content:         f.text,
		},
		Usage: imageUsageResponse(f.usage, costBreakdown),
	})
}
