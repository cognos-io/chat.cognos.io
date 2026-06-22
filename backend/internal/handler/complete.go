package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/cognos-io/chat.cognos.io/backend/internal/analytics"
	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/persona"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

type completionMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Name    string `json:"name,omitempty"`
}

type completeRequest struct {
	Messages        []completionMessage `json:"messages"`
	ModelID         string              `json:"model_id"`
	PersonaID       string              `json:"persona_id"`
	SystemPrompt    string              `json:"system_prompt"`
	ParentMessageID string              `json:"parent_message_id,omitempty"`
	RequestID       string              `json:"request_id,omitempty"`
	MaxOutputTokens int                 `json:"max_output_tokens,omitempty"`
	Persist         *bool               `json:"persist,omitempty"`
}

type CompleteRequest = completeRequest

const maxSystemPromptChars = 20000

type CompleteBillingRestriction struct {
	Error            string   `json:"error"`
	Message          string   `json:"message"`
	BalanceCHF       *float64 `json:"balance_chf,omitempty"`
	EstimatedCostCHF *float64 `json:"estimated_cost_chf,omitempty"`
	NextStep         string   `json:"next_step,omitempty"`
}

type CompleteBillingGateFunc func(
	owner *auth.User,
	model catalogue.Model,
	req CompleteRequest,
) (*CompleteBillingRestriction, error)

type usageResponse struct {
	InputTokens              int64   `json:"input_tokens"`
	OutputTokens             int64   `json:"output_tokens"`
	TotalTokens              int64   `json:"total_tokens"`
	CacheCreationInputTokens int64   `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int64   `json:"cache_read_input_tokens"`
	CostUSD                  float64 `json:"cost_usd"`
	CostCHF                  float64 `json:"cost_chf"`
	CostRappen               int64   `json:"cost_rappen"`
	UsedProviderCost         bool    `json:"used_provider_cost"`
}

type assistantMessageResponse struct {
	ID              string `json:"id,omitempty"`
	ParentMessageID string `json:"parent_message_id,omitempty"`
	Content         string `json:"content"`
	PersonaID       string `json:"persona_id"`
	ModelID         string `json:"model_id"`
	CreatedAt       string `json:"created_at"`
}

type completeResponse struct {
	RequestID        string                   `json:"request_id,omitempty"`
	UserMessageID    string                   `json:"user_message_id,omitempty"`
	AssistantMessage assistantMessageResponse `json:"assistant_message"`
	ExpiresAt        string                   `json:"expires_at,omitempty"`
	Usage            usageResponse            `json:"usage"`
}

const completeStreamHeartbeatInterval = 15 * time.Second

type CompletionStopper struct {
	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

func NewCompletionStopper() *CompletionStopper {
	return &CompletionStopper{cancels: map[string]context.CancelFunc{}}
}

func (s *CompletionStopper) Register(ownerID string, requestID string, cancel context.CancelFunc) func() {
	if s == nil || ownerID == "" || requestID == "" || cancel == nil {
		return func() {}
	}

	key := completionStopKey(ownerID, requestID)
	s.mu.Lock()
	s.cancels[key] = cancel
	s.mu.Unlock()

	return func() {
		s.mu.Lock()
		delete(s.cancels, key)
		s.mu.Unlock()
	}
}

func (s *CompletionStopper) Stop(ownerID string, requestID string) bool {
	if s == nil || ownerID == "" || requestID == "" {
		return false
	}

	key := completionStopKey(ownerID, requestID)
	s.mu.Lock()
	cancel := s.cancels[key]
	s.mu.Unlock()

	if cancel == nil {
		return false
	}
	cancel()
	return true
}

func completionStopKey(ownerID string, requestID string) string {
	return ownerID + ":" + requestID
}

type completeStreamResponse struct {
	Type     string            `json:"type"`
	Delta    string            `json:"delta,omitempty"`
	Message  string            `json:"message,omitempty"`
	Response *completeResponse `json:"response,omitempty"`
}

type CompleteHandlerParams struct {
	Logger              *slog.Logger
	CatalogueService    catalogue.Service
	GatewayClient       gateway.Client
	MessageRepo         chat.MessageRepo
	ConversationRepo    chat.ConversationRepo
	BillingService      *billing.Service
	BillingStateRepo    billing.StateRepo
	BillingLedgerRepo   billing.LedgerRepo
	FXRateProvider      billing.FXRateProvider
	UsageEmitter        analytics.Emitter
	CompleteBillingGate CompleteBillingGateFunc
	CompletionStopper   *CompletionStopper
	// App backs conversation-scoped access checks. When set,
	// /api/v1/conversations/{id}/complete returns 404 to callers who cannot
	// access the target conversation — gated by project membership for project
	// conversations, or conversation participants otherwise. Left nil only in
	// unit tests that have already pre-validated access (production always
	// sets it).
	App core.App
}

func Complete(params CompleteHandlerParams) func(e *core.RequestEvent) error {
	return complete(params, false, false)
}

func CompleteConversation(params CompleteHandlerParams) func(e *core.RequestEvent) error {
	return complete(params, true, false)
}

// RegenerateConversation produces a new assistant response to an EXISTING
// message instead of persisting a fresh user turn. The new assistant message
// is parented to req.ParentMessageID, making it a sibling branch of any
// previous response to the same message.
func RegenerateConversation(params CompleteHandlerParams) func(e *core.RequestEvent) error {
	return complete(params, true, true)
}

func StopCompletion(stopper *CompletionStopper) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		owner := auth.ExtractUser(e)
		if owner == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		requestID := strings.TrimSpace(e.Request.PathValue("requestID"))
		if requestID == "" {
			return apis.NewBadRequestError("Request ID is required", nil)
		}

		if stopper != nil {
			stopper.Stop(owner.ID, requestID)
		}

		return e.NoContent(http.StatusNoContent)
	}
}

func complete(params CompleteHandlerParams, useConversationPath bool, regenerate bool) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		owner := auth.ExtractUser(e)
		if owner == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		var req completeRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}

		req.ModelID = strings.TrimSpace(req.ModelID)
		req.PersonaID = strings.TrimSpace(req.PersonaID)
		req.SystemPrompt = strings.TrimSpace(req.SystemPrompt)
		req.ParentMessageID = strings.TrimSpace(req.ParentMessageID)
		req.RequestID = strings.TrimSpace(req.RequestID)

		if req.ModelID == "" {
			return apis.NewBadRequestError("Model ID is required", nil)
		}
		if req.PersonaID == "" {
			return apis.NewBadRequestError("Persona ID is required", nil)
		}
		if req.SystemPrompt == "" {
			return apis.NewBadRequestError("System prompt is required", nil)
		}
		if len(req.SystemPrompt) > maxSystemPromptChars {
			return apis.NewBadRequestError("System prompt is too long", nil)
		}
		if len(req.Messages) == 0 {
			return apis.NewBadRequestError("At least one message is required", nil)
		}

		lastMessage := req.Messages[len(req.Messages)-1]
		if strings.TrimSpace(lastMessage.Content) == "" {
			return apis.NewBadRequestError("Last message content is required", nil)
		}
		if lastMessage.Role != "user" {
			return apis.NewBadRequestError("Last message must have role user", nil)
		}
		if regenerate && req.ParentMessageID == "" {
			return apis.NewBadRequestError("Parent message ID is required to regenerate", nil)
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

		prompt := persona.Prompt{SystemMessage: req.SystemPrompt}

		conversationID := ""
		if useConversationPath {
			conversationID = e.Request.PathValue("conversationID")
		}

		shouldPersist := conversationID != ""
		if req.Persist != nil {
			shouldPersist = *req.Persist && conversationID != ""
		}

		var conversation chat.Conversation
		if shouldPersist {
			if params.App != nil {
				// Authorise the caller against the conversation BEFORE we
				// reveal whether the conversation exists. A non-participant
				// must get the same 404 a non-existent conversation would,
				// otherwise the response shape leaks "this ID is real."
				// Project conversations gate on project membership; standalone
				// conversations on their participants.
				active, err := conversationAccessibleByID(params.App, conversationID, owner.ID)
				if err != nil {
					params.Logger.Error("conversation access lookup failed", "err", err)
					return apis.NewApiError(http.StatusInternalServerError, "Failed to verify conversation access", err)
				}
				if !active {
					return apis.NewNotFoundError("Conversation not found or unable to load", nil)
				}
			}

			conversation, err = params.ConversationRepo.ByID(conversationID)
			if err != nil {
				return apis.NewNotFoundError("Conversation not found or unable to load", err)
			}
		}

		var billingState *billing.State

		if params.CompleteBillingGate != nil {
			restriction, err := params.CompleteBillingGate(owner, model, req)
			if err != nil {
				params.Logger.Error("billing gate failed", "err", err)
				return apis.NewApiError(http.StatusInternalServerError, "Failed to evaluate billing access", err)
			}
			if restriction != nil {
				return e.JSON(http.StatusPaymentRequired, restriction)
			}
		} else if params.BillingStateRepo != nil && params.BillingService != nil {
			state, err := params.BillingStateRepo.StateForUser(owner.ID)
			if err != nil {
				if !errors.Is(err, billing.ErrStateNotFound) {
					params.Logger.Error("billing state lookup failed", "err", err)
					return apis.NewApiError(http.StatusInternalServerError, "Failed to evaluate billing access", err)
				}
			} else {
				estimatedCost := params.BillingService.EstimateUpperBoundCost(
					model,
					req.MaxOutputTokens,
					completionUSDToCHFRate(params),
				)
				if restriction := params.BillingService.EvaluateAccess(state, estimatedCost.CostMicroRappen); restriction != nil {
					return e.JSON(http.StatusPaymentRequired, completeBillingRestrictionResponse(*restriction, estimatedCost.CostCHF))
				}
				billingState = &state
			}
		}

		if params.GatewayClient == nil {
			params.Logger.Error("gateway client unavailable")
			return apis.NewApiError(http.StatusServiceUnavailable, "Provider is unavailable", nil)
		}

		personaMessages := make([]persona.Message, 0, len(req.Messages))
		for _, message := range req.Messages {
			personaMessages = append(personaMessages, persona.Message{
				Role:    message.Role,
				Content: message.Content,
				Name:    message.Name,
			})
		}
		personaMessages = persona.BuildMessages(prompt, personaMessages)

		messages := make([]gateway.Message, 0, len(personaMessages))
		for _, message := range personaMessages {
			messages = append(messages, gateway.Message{
				Role:    message.Role,
				Content: message.Content,
				Name:    message.Name,
			})
		}

		// The assistant response is parented to the freshly persisted user
		// message in the normal flow, or to the existing message being
		// regenerated.
		assistantParentID := req.ParentMessageID

		var userMessageRecord *core.Record
		if shouldPersist {
			if regenerate {
				// Confirm the parent message exists and belongs to this
				// conversation before we attach a sibling to it — otherwise a
				// caller could parent a response onto another thread's message.
				parentRecord, err := e.App.FindRecordById("messages", req.ParentMessageID)
				if err != nil || parentRecord.GetString("conversation") != conversationID {
					return apis.NewNotFoundError("Parent message not found or unable to load", nil)
				}
			} else {
				err, userMessageRecord = params.MessageRepo.EncryptAndPersistMessage(
					conversation,
					req.ParentMessageID,
					chat.MessageRecordData{
						OwnerID:   owner.ID,
						Content:   lastMessage.Content,
						CreatedAt: time.Now().UTC().Format(time.RFC3339),
					},
				)
				if err != nil {
					params.Logger.Error("failed to save request message", "err", err)
					return apis.NewApiError(http.StatusInternalServerError, "Failed to save request message", err)
				}
				assistantParentID = userMessageRecord.Id
			}
		}

		gatewayStartedAt := time.Now()
		gatewayReq := gateway.CompleteRequest{
			ProviderID:      model.ProviderID,
			ProviderModelID: model.ProviderModelID,
			Messages:        messages,
			MaxOutputTokens: req.MaxOutputTokens,
		}

		gatewayResp, clientDisconnected, _, err := streamGatewayCompletion(e, params, gatewayReq, owner.ID, req.RequestID)
		if err != nil {
			if userMessageRecord != nil {
				if deleteErr := params.MessageRepo.DeleteMessage(userMessageRecord.Id); deleteErr != nil {
					params.Logger.Error("failed to clean up request message", "err", deleteErr)
				}
			}
			params.Logger.Error(
				"completion upstream request failed",
				"provider", model.ProviderID,
				"err", err,
			)
			if !e.Written() {
				return apis.NewApiError(http.StatusServiceUnavailable, "Failed to process completion", nil)
			}
			if !clientDisconnected {
				if writeErr := writeCompleteStreamEvent(e, completeStreamResponse{
					Type:    "error",
					Message: "Failed to process completion",
				}); writeErr != nil {
					params.Logger.Error("failed to write stream error event", "err", writeErr)
				}
			}
			return nil
		}

		assistantCreatedAt := time.Now().UTC().Format(time.RFC3339)

		var assistantMessageRecord *core.Record
		if shouldPersist {
			err, assistantMessageRecord = params.MessageRepo.EncryptAndPersistMessage(
				conversation,
				assistantParentID,
				chat.MessageRecordData{
					Content:   gatewayResp.Message.Content,
					PersonaID: req.PersonaID,
					ModelID:   model.ID,
					CreatedAt: assistantCreatedAt,
				},
			)
			if err != nil {
				params.Logger.Error("failed to save response message", "err", err)
				return apis.NewApiError(http.StatusInternalServerError, "Failed to save response message", err)
			}
		}

		usdToCHFRate := completionUSDToCHFRate(params)
		eventID := uuid.NewString()

		costBreakdown := params.BillingService.CalculateCost(model, billing.Usage{
			InputTokens:              gatewayResp.Usage.InputTokens,
			OutputTokens:             gatewayResp.Usage.OutputTokens,
			CacheCreationInputTokens: gatewayResp.Usage.CacheCreationInputTokens,
			CacheReadInputTokens:     gatewayResp.Usage.CacheReadInputTokens,
			ProviderCostUSD:          gatewayResp.Usage.ProviderCostUSD,
		}, usdToCHFRate)

		if billingState != nil {
			if params.BillingLedgerRepo != nil {
				usageRecord := params.BillingService.BuildUsageRecord(*billingState, billing.BuildUsageRecordInput{
					UserID:       owner.ID,
					EventID:      eventID,
					ModelID:      model.ID,
					Cost:         costBreakdown,
					FXRateUSDCHF: usdToCHFRate,
					InputTokens:  gatewayResp.Usage.InputTokens,
					OutputTokens: gatewayResp.Usage.OutputTokens,
				})
				if err := params.BillingLedgerRepo.RecordUsage(usageRecord); err != nil {
					params.Logger.Error("failed to record billing usage", "err", err)
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
					params.Logger.Error("failed to emit analytics usage event", "err", err)
				}
			}
		}

		response := completeResponse{
			RequestID: req.RequestID,
			AssistantMessage: assistantMessageResponse{
				Content:   gatewayResp.Message.Content,
				PersonaID: req.PersonaID,
				ModelID:   model.ID,
				CreatedAt: assistantCreatedAt,
			},
			Usage: usageResponse{
				InputTokens:              gatewayResp.Usage.InputTokens,
				OutputTokens:             gatewayResp.Usage.OutputTokens,
				TotalTokens:              gatewayResp.Usage.TotalTokens,
				CacheCreationInputTokens: costBreakdown.CacheCreationInputTokens,
				CacheReadInputTokens:     costBreakdown.CacheReadInputTokens,
				CostUSD:                  costBreakdown.CostUSD,
				CostCHF:                  costBreakdown.CostCHF,
				CostRappen:               costBreakdown.CostRappen,
				UsedProviderCost:         costBreakdown.UsedProviderCost,
			},
		}

		if userMessageRecord != nil {
			response.UserMessageID = userMessageRecord.Id
			response.AssistantMessage.ParentMessageID = userMessageRecord.Id
		} else if regenerate {
			response.AssistantMessage.ParentMessageID = req.ParentMessageID
		}
		if assistantMessageRecord != nil {
			response.AssistantMessage.ID = assistantMessageRecord.Id
		}
		if conversation.ExpiryDuration > 0 {
			response.ExpiresAt = time.Now().UTC().Add(conversation.ExpiryDuration).Format(time.RFC3339)
		}

		if clientDisconnected {
			return nil
		}

		return writeCompleteStreamEvent(e, completeStreamResponse{
			Type:     "complete",
			Response: &response,
		})
	}
}

func streamGatewayCompletion(
	e *core.RequestEvent,
	params CompleteHandlerParams,
	req gateway.CompleteRequest,
	ownerID string,
	requestID string,
) (gateway.CompleteResponse, bool, bool, error) {
	// Detach from the client request context so a tab close or network drop
	// does not cancel the upstream LLM call. We still finish the completion,
	// persist the full assistant message, and record billing. Explicit user stop
	// requests get their own cancellable child context.
	streamCtx := context.WithoutCancel(e.Request.Context())
	if params.CompletionStopper != nil && requestID != "" {
		var cancel context.CancelFunc
		streamCtx, cancel = context.WithCancel(streamCtx)
		unregister := params.CompletionStopper.Register(ownerID, requestID, cancel)
		defer unregister()
	}

	return collectGatewayStream(streamCtx, params.GatewayClient, req, func(delta string) error {
		return writeCompleteStreamEvent(e, completeStreamResponse{
			Type:  "delta",
			Delta: delta,
		})
	}, func() error {
		return writeCompleteStreamHeartbeat(e)
	}, func(err error) {
		params.Logger.Info("client disconnected during completion stream", "err", err)
	})
}

func collectGatewayStream(
	ctx context.Context,
	client gateway.Client,
	req gateway.CompleteRequest,
	onDelta func(string) error,
	onHeartbeat func() error,
	onClientDisconnect func(error),
) (gateway.CompleteResponse, bool, bool, error) {
	return collectGatewayStreamWithHeartbeat(
		ctx,
		client,
		req,
		onDelta,
		onHeartbeat,
		onClientDisconnect,
		completeStreamHeartbeatInterval,
	)
}

func collectGatewayStreamWithHeartbeat(
	ctx context.Context,
	client gateway.Client,
	req gateway.CompleteRequest,
	onDelta func(string) error,
	onHeartbeat func() error,
	onClientDisconnect func(error),
	heartbeatInterval time.Duration,
) (gateway.CompleteResponse, bool, bool, error) {
	stream, err := client.CompleteStream(ctx, req)
	if err != nil {
		return gateway.CompleteResponse{}, false, false, err
	}

	var heartbeatC <-chan time.Time
	var heartbeat *time.Ticker
	if heartbeatInterval > 0 && onHeartbeat != nil {
		heartbeat = time.NewTicker(heartbeatInterval)
		heartbeatC = heartbeat.C
		defer heartbeat.Stop()
	}

	var builder strings.Builder
	usage := gateway.Usage{}
	clientDisconnected := false

	for {
		select {
		case <-ctx.Done():
			return gateway.CompleteResponse{
				Message: gateway.Message{
					Role:    "assistant",
					Content: builder.String(),
				},
				Usage: usage,
			}, clientDisconnected, true, nil
		case <-heartbeatC:
			if !clientDisconnected {
				if err := onHeartbeat(); err != nil {
					clientDisconnected = true
					onClientDisconnect(err)
				}
			}
		case event, ok := <-stream:
			if !ok {
				return gateway.CompleteResponse{
					Message: gateway.Message{
						Role:    "assistant",
						Content: builder.String(),
					},
					Usage: usage,
				}, clientDisconnected, false, nil
			}
			if event.Err != nil {
				return gateway.CompleteResponse{}, clientDisconnected, false, event.Err
			}
			if event.Delta != "" {
				builder.WriteString(event.Delta)
				if !clientDisconnected {
					if err := onDelta(event.Delta); err != nil {
						clientDisconnected = true
						onClientDisconnect(err)
					}
				}
			}
			if event.Usage != nil {
				usage = *event.Usage
			}
		}
	}
}

func writeCompleteStreamEvent(e *core.RequestEvent, response completeStreamResponse) error {
	setCompleteStreamHeaders(e)

	payload, err := json.Marshal(response)
	if err != nil {
		return err
	}
	if _, err := e.Response.Write([]byte("data: ")); err != nil {
		return err
	}
	if _, err := e.Response.Write(payload); err != nil {
		return err
	}
	if _, err := e.Response.Write([]byte("\n\n")); err != nil {
		return err
	}

	return e.Flush()
}

func writeCompleteStreamHeartbeat(e *core.RequestEvent) error {
	setCompleteStreamHeaders(e)
	if _, err := e.Response.Write([]byte(": keep-alive\n\n")); err != nil {
		return err
	}
	return e.Flush()
}

func setCompleteStreamHeaders(e *core.RequestEvent) {
	e.Response.Header().Set("Content-Type", "text/event-stream")
	e.Response.Header().Set("Cache-Control", "no-cache, no-transform")
	e.Response.Header().Set("Connection", "keep-alive")
	e.Response.Header().Set("X-Accel-Buffering", "no")
}

func completionUSDToCHFRate(params CompleteHandlerParams) float64 {
	if params.FXRateProvider != nil {
		return params.FXRateProvider.USDToCHF()
	}
	return 1
}

func completeBillingRestrictionResponse(
	restriction billing.AccessRestriction,
	estimatedCostCHF float64,
) CompleteBillingRestriction {
	response := CompleteBillingRestriction{
		Error:    restriction.Error,
		Message:  restriction.Message,
		NextStep: restriction.NextStep,
	}
	if restriction.BalanceRappen != nil {
		balanceCHF := float64(*restriction.BalanceRappen) / 100
		response.BalanceCHF = &balanceCHF
	}
	if restriction.EstimatedCostRappen != nil {
		costCHF := float64(*restriction.EstimatedCostRappen) / 100
		response.EstimatedCostCHF = &costCHF
	} else if estimatedCostCHF > 0 {
		response.EstimatedCostCHF = &estimatedCostCHF
	}
	return response
}
