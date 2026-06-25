package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/analytics"
	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/compaction"
	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
)

// compactionMaxOutputTokens caps the summary length. Compaction must shrink
// context, so a generous-but-bounded ceiling keeps cost predictable.
const compactionMaxOutputTokens = 2000

// CompactionHandlerParams carries the dependencies the compaction endpoints
// need. Billing deps are optional: compaction records usage best-effort but is
// never gated (it is background work and must not 402 — spec §10.2, §13).
type CompactionHandlerParams struct {
	App              core.App
	Logger           *slog.Logger
	CatalogueService catalogue.Service
	GatewayClient    gateway.Client
	ConversationRepo chat.ConversationRepo
	CompactionRepo   compaction.Repo

	BillingService    *billing.Service
	BillingStateRepo  billing.StateRepo
	BillingLedgerRepo billing.LedgerRepo
	FXRateProvider    billing.FXRateProvider
	UsageEmitter      analytics.Emitter
}

type compactionMessageInput struct {
	Alias     string `json:"alias"`
	MessageID string `json:"message_id"`
	Role      string `json:"role"`
	Content   string `json:"content"`
}

type compactionPriorSummary struct {
	DurableMemory     compaction.DurableMemory `json:"durable_memory"`
	RollingNarrative  string                   `json:"rolling_narrative"`
	CoveredMessageIDs []string                 `json:"covered_message_ids"`
}

type createCompactionRequest struct {
	RequestID           string                   `json:"request_id"`
	ModelID             string                   `json:"model_id"`
	AnchorMessageID     string                   `json:"anchor_message_id"`
	SourceTokenEstimate int                      `json:"source_token_estimate"`
	Prior               *compactionPriorSummary  `json:"prior_summary,omitempty"`
	ParentCompactionID  string                   `json:"parent_compaction_id,omitempty"`
	ParentCompactionLvl int                      `json:"parent_compaction_level,omitempty"`
	Messages            []compactionMessageInput `json:"messages"`
}

// compactionRecordResponse is the plaintext-safe projection of a stored
// compaction: only routing fields plus the opaque ciphertext blob.
type compactionRecordResponse struct {
	ID           string `json:"id"`
	Conversation string `json:"conversation"`
	Data         string `json:"data"`
	Created      string `json:"created"`
	Updated      string `json:"updated"`
}

type createCompactionResponse struct {
	compactionRecordResponse
	// Skipped reports that no compaction was created (e.g. the model is not
	// eligible). The client falls back to raw-tail truncation.
	Skipped bool   `json:"skipped,omitempty"`
	Reason  string `json:"reason,omitempty"`
	// Payload is the plaintext compaction returned for immediate local use so the
	// client need not re-fetch and decrypt what it just created (spec §15). Never
	// logged.
	Payload *compaction.Payload `json:"payload,omitempty"`
}

type listCompactionsResponse struct {
	Items []compactionRecordResponse `json:"items"`
}

func toRecordResponse(record *core.Record) compactionRecordResponse {
	return compactionRecordResponse{
		ID:           record.Id,
		Conversation: record.GetString("conversation"),
		Data:         record.GetString("data"),
		Created:      record.GetDateTime("created").Time().UTC().Format(time.RFC3339),
		Updated:      record.GetDateTime("updated").Time().UTC().Format(time.RFC3339),
	}
}

// CompactionCreate runs the backend-owned compaction prompt for an active-branch
// prefix, encrypts the summary to the conversation key, and persists it.
func CompactionCreate(params CompactionHandlerParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		owner := auth.ExtractUser(e)
		if owner == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		conversationID := strings.TrimSpace(e.Request.PathValue("conversationID"))
		active, err := conversationAccessibleByID(params.App, conversationID, owner.ID)
		if err != nil {
			params.Logger.Error("conversation access lookup failed", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify conversation access", err)
		}
		if !active {
			return apis.NewNotFoundError("Conversation not found", nil)
		}

		var req createCompactionRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Invalid request body", err)
		}
		req.ModelID = strings.TrimSpace(req.ModelID)
		req.AnchorMessageID = strings.TrimSpace(req.AnchorMessageID)
		req.ParentCompactionID = strings.TrimSpace(req.ParentCompactionID)

		if req.ModelID == "" {
			return apis.NewBadRequestError("Model ID is required", nil)
		}
		if req.AnchorMessageID == "" {
			return apis.NewBadRequestError("Anchor message ID is required", nil)
		}
		if len(req.Messages) == 0 {
			return apis.NewBadRequestError("At least one message is required", nil)
		}

		model, ok, err := params.CatalogueService.GetModelByID(context.Background(), req.ModelID)
		if err != nil {
			params.Logger.Error("catalogue lookup failed", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load model", err)
		}
		if !ok || !model.IsActive {
			return apis.NewBadRequestError("Invalid model ID", nil)
		}

		userTier := catalogue.NormalizePrivacyTier(e.Auth.GetString("privacy_tier"))
		if !catalogue.IsEligibleForTier(userTier, model.PrivacyTier) {
			return apis.NewForbiddenError("Model is not available for the user's privacy tier", nil)
		}

		// Capability gate: a model that cannot compact yields a skip response so
		// the client falls back to raw-tail truncation (spec §7.1, §13).
		if !model.EligibleForCompaction {
			return e.JSON(http.StatusOK, createCompactionResponse{
				Skipped: true,
				Reason:  "model is not eligible for compaction",
			})
		}

		// Anchor must belong to this conversation, otherwise a caller could
		// anchor a summary onto another thread's message.
		if !messageBelongsToConversation(params.App, req.AnchorMessageID, conversationID) {
			return apis.NewBadRequestError("Anchor message does not belong to the conversation", nil)
		}
		if req.ParentCompactionID != "" && !compactionBelongsToConversation(params, req.ParentCompactionID, conversationID) {
			return apis.NewBadRequestError("Parent compaction does not belong to the conversation", nil)
		}

		conversation, err := params.ConversationRepo.ByID(conversationID)
		if err != nil {
			return apis.NewNotFoundError("Conversation not found or unable to load", err)
		}

		inputMessages := make([]compaction.InputMessage, 0, len(req.Messages))
		for _, m := range req.Messages {
			role := strings.TrimSpace(m.Role)
			if role != "user" && role != "assistant" {
				return apis.NewBadRequestError("Message role must be user or assistant", nil)
			}
			inputMessages = append(inputMessages, compaction.InputMessage{
				Alias:     strings.TrimSpace(m.Alias),
				MessageID: strings.TrimSpace(m.MessageID),
				Role:      role,
				Content:   m.Content,
			})
		}

		var prior *compaction.PriorSummary
		compactionLevel := 0
		if req.Prior != nil {
			prior = &compaction.PriorSummary{
				DurableMemory:     req.Prior.DurableMemory,
				RollingNarrative:  req.Prior.RollingNarrative,
				CoveredMessageIDs: req.Prior.CoveredMessageIDs,
			}
			compactionLevel = req.ParentCompactionLvl + 1
		}

		if params.GatewayClient == nil {
			params.Logger.Error("gateway client unavailable")
			return apis.NewApiError(http.StatusServiceUnavailable, "Provider is unavailable", nil)
		}

		parsed, usage, err := runCompaction(params, model, prior, inputMessages)
		if err != nil {
			params.Logger.Error("compaction generation failed", "provider", model.ProviderID, "err", err)
			return apis.NewApiError(http.StatusBadGateway, "Failed to generate compaction", err)
		}

		payload := compaction.Assemble(compaction.AssembleInput{
			ConversationID:      conversationID,
			AnchorMessageID:     req.AnchorMessageID,
			Prior:               prior,
			ParentCompactionID:  req.ParentCompactionID,
			Messages:            inputMessages,
			SourceTokenEstimate: req.SourceTokenEstimate,
			ModelID:             model.ID,
			OutputMode:          compaction.OutputModeDelimitedText,
			CreatedAt:           time.Now().UTC().Format(time.RFC3339),
		}, parsed, compactionLevel)

		record, err := params.CompactionRepo.Create(conversationID, conversation.PublicKey, payload)
		if err != nil {
			params.Logger.Error("failed to persist compaction", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to save compaction", err)
		}

		recordCompactionUsage(params, owner.ID, userTier, model, usage)

		return e.JSON(http.StatusOK, createCompactionResponse{
			compactionRecordResponse: toRecordResponse(record),
			Payload:                  &payload,
		})
	}
}

// runCompaction calls the provider with the backend-owned prompt and parses the
// result, retrying parsing once if the first output is not recoverable JSON.
func runCompaction(
	params CompactionHandlerParams,
	model catalogue.Model,
	prior *compaction.PriorSummary,
	messages []compaction.InputMessage,
) (compaction.ParseResult, gateway.Usage, error) {
	gatewayMessages := []gateway.Message{
		{Role: "system", Content: compaction.SystemPrompt()},
		{Role: "user", Content: compaction.BuildUserContent(prior, messages)},
	}

	maxOutput := compactionMaxOutputTokens
	if model.MaxOutputTokens > 0 && model.MaxOutputTokens < maxOutput {
		maxOutput = model.MaxOutputTokens
	}

	aliasMap := compaction.AliasMap(messages)

	var lastErr error
	var totalUsage gateway.Usage
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := params.GatewayClient.Complete(context.Background(), gateway.CompleteRequest{
			ProviderID:      model.ProviderID,
			ProviderModelID: model.ProviderModelID,
			Messages:        gatewayMessages,
			MaxOutputTokens: maxOutput,
		})
		if err != nil {
			return compaction.ParseResult{}, totalUsage, err
		}
		totalUsage = addUsage(totalUsage, resp.Usage)

		parsed, parseErr := compaction.Parse(resp.Message.Content, aliasMap)
		if parseErr == nil {
			return parsed, totalUsage, nil
		}
		lastErr = parseErr
	}
	return compaction.ParseResult{}, totalUsage, lastErr
}

func addUsage(a, b gateway.Usage) gateway.Usage {
	a.InputTokens += b.InputTokens
	a.OutputTokens += b.OutputTokens
	a.TotalTokens += b.TotalTokens
	a.CacheCreationInputTokens += b.CacheCreationInputTokens
	a.CacheReadInputTokens += b.CacheReadInputTokens
	a.ReasoningTokens += b.ReasoningTokens
	return a
}

// recordCompactionUsage records billing/analytics for the compaction provider
// call best-effort. Failures here never fail the request — the summary is
// already persisted and the user must not be blocked on accounting.
func recordCompactionUsage(
	params CompactionHandlerParams,
	userID string,
	userTier catalogue.PrivacyTier,
	model catalogue.Model,
	usage gateway.Usage,
) {
	if params.BillingService == nil || params.BillingStateRepo == nil {
		return
	}
	state, err := params.BillingStateRepo.StateForUser(userID)
	if err != nil {
		if !errors.Is(err, billing.ErrStateNotFound) {
			params.Logger.Error("compaction billing state lookup failed", "err", err)
		}
		return
	}

	usdToCHFRate := float64(1)
	if params.FXRateProvider != nil {
		usdToCHFRate = params.FXRateProvider.USDToCHF()
	}

	cost := params.BillingService.CalculateCost(model, billing.Usage{
		InputTokens:              usage.InputTokens,
		OutputTokens:             usage.OutputTokens,
		CacheCreationInputTokens: usage.CacheCreationInputTokens,
		CacheReadInputTokens:     usage.CacheReadInputTokens,
		ProviderCostUSD:          usage.ProviderCostUSD,
	}, usdToCHFRate)

	eventID := uuid.NewString()
	if params.BillingLedgerRepo != nil {
		usageRecord := params.BillingService.BuildUsageRecord(state, billing.BuildUsageRecordInput{
			UserID:       userID,
			EventID:      eventID,
			ModelID:      model.ID,
			Cost:         cost,
			FXRateUSDCHF: usdToCHFRate,
			InputTokens:  usage.InputTokens,
			OutputTokens: usage.OutputTokens,
		})
		if err := params.BillingLedgerRepo.RecordUsage(usageRecord); err != nil {
			params.Logger.Error("failed to record compaction billing usage", "err", err)
		}
	}

	if params.UsageEmitter != nil {
		billingUserID := state.BillingUserID
		if billingUserID == "" {
			billingUserID = userID
		}
		event := analytics.BuildUsageEvent(analytics.BuildUsageEventInput{
			EventID:       eventID,
			OccurredAt:    time.Now().UTC(),
			BillingUserID: billingUserID,
			PlanType:      state.PlanType,
			Model:         model,
			PrivacyTier:   userTier,
			Cost:          cost,
			FXRateUSDCHF:  usdToCHFRate,
		})
		if err := params.UsageEmitter.Emit(event); err != nil {
			params.Logger.Error("failed to emit compaction analytics event", "err", err)
		}
	}
}

// CompactionList returns the encrypted compaction records for a conversation.
func CompactionList(params CompactionHandlerParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		owner := auth.ExtractUser(e)
		if owner == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		conversationID := strings.TrimSpace(e.Request.PathValue("conversationID"))
		active, err := conversationAccessibleByID(params.App, conversationID, owner.ID)
		if err != nil {
			params.Logger.Error("conversation access lookup failed", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify conversation access", err)
		}
		if !active {
			return apis.NewNotFoundError("Conversation not found", nil)
		}

		records, err := params.CompactionRepo.ListByConversation(conversationID)
		if err != nil {
			params.Logger.Error("failed to list compactions", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load compactions", err)
		}

		items := make([]compactionRecordResponse, 0, len(records))
		for _, record := range records {
			items = append(items, toRecordResponse(record))
		}
		return e.JSON(http.StatusOK, listCompactionsResponse{Items: items})
	}
}

// CompactionDelete removes a compaction, used when a covered message is deleted
// or re-redacted and the summary is no longer valid (spec §12).
func CompactionDelete(params CompactionHandlerParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		owner := auth.ExtractUser(e)
		if owner == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		compactionID := strings.TrimSpace(e.Request.PathValue("id"))
		record, err := params.CompactionRepo.ByID(compactionID)
		if err != nil {
			return apis.NewNotFoundError("Compaction not found", nil)
		}

		// Authorise via the owning conversation before confirming existence.
		active, err := conversationAccessibleByID(params.App, record.GetString("conversation"), owner.ID)
		if err != nil {
			params.Logger.Error("conversation access lookup failed", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify conversation access", err)
		}
		if !active {
			return apis.NewNotFoundError("Compaction not found", nil)
		}

		if err := params.CompactionRepo.Delete(compactionID); err != nil {
			params.Logger.Error("failed to delete compaction", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to delete compaction", err)
		}
		return e.NoContent(http.StatusNoContent)
	}
}

func messageBelongsToConversation(app core.App, messageID, conversationID string) bool {
	record, err := app.FindRecordById("messages", messageID)
	if err != nil {
		return false
	}
	return record.GetString("conversation") == conversationID
}

func compactionBelongsToConversation(params CompactionHandlerParams, compactionID, conversationID string) bool {
	record, err := params.CompactionRepo.ByID(compactionID)
	if err != nil {
		return false
	}
	return record.GetString("conversation") == conversationID
}
