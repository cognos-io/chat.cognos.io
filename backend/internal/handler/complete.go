package handler

import (
	"errors"
	"log/slog"
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
	"github.com/cognos-io/chat.cognos.io/backend/pkg/aiagent"
	compatopenai "github.com/cognos-io/chat.cognos.io/backend/pkg/compat/openai"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	oai "github.com/sashabaranov/go-openai"
)

type completionMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Name    string `json:"name,omitempty"`
}

type completeRequest struct {
	Messages        []completionMessage `json:"messages"`
	ModelID         string              `json:"model_id"`
	AgentID         string              `json:"agent_id"`
	ParentMessageID string              `json:"parent_message_id,omitempty"`
	RequestID       string              `json:"request_id,omitempty"`
	MaxOutputTokens int                 `json:"max_output_tokens,omitempty"`
	Persist         *bool               `json:"persist,omitempty"`
}

type CompleteRequest = completeRequest

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
	AgentID         string `json:"agent_id"`
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

type CompleteHandlerParams struct {
	Logger              *slog.Logger
	GatewayClient       gateway.Client
	MessageRepo         chat.MessageRepo
	ConversationRepo    chat.ConversationRepo
	AgentRepo           aiagent.AIAgentRepo
	BillingService      *billing.Service
	BillingStateRepo    billing.StateRepo
	BillingLedgerRepo   billing.LedgerRepo
	FXRateProvider      billing.FXRateProvider
	UsageEmitter        analytics.Emitter
	CompleteBillingGate CompleteBillingGateFunc
}

func Complete(params CompleteHandlerParams) func(e *core.RequestEvent) error {
	return complete(params, false)
}

func CompleteConversation(params CompleteHandlerParams) func(e *core.RequestEvent) error {
	return complete(params, true)
}

func complete(params CompleteHandlerParams, useConversationPath bool) func(e *core.RequestEvent) error {
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
		req.AgentID = strings.TrimSpace(req.AgentID)
		req.ParentMessageID = strings.TrimSpace(req.ParentMessageID)
		req.RequestID = strings.TrimSpace(req.RequestID)

		if req.ModelID == "" {
			return apis.NewBadRequestError("Model ID is required", nil)
		}
		if req.AgentID == "" {
			return apis.NewBadRequestError("Agent ID is required", nil)
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

		model, ok := catalogue.GetModelByID(req.ModelID)
		if !ok || !model.IsActive {
			return apis.NewBadRequestError("Invalid model ID", nil)
		}

		userTier := catalogue.NormalizePrivacyTier(e.Auth.GetString("privacy_tier"))
		if !catalogue.IsEligibleForTier(userTier, model.PrivacyTier) {
			return apis.NewForbiddenError("Model is not available for the user's privacy tier", nil)
		}

		agent, err := params.AgentRepo.LookupPrompt(req.AgentID)
		if err != nil {
			if errors.Is(err, aiagent.ErrAgentNotFound) {
				return apis.NewBadRequestError("Invalid agent ID", err)
			}
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load agent", err)
		}

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
				if restriction := params.BillingService.EvaluateAccess(state, estimatedCost.CostRappen); restriction != nil {
					return e.JSON(http.StatusPaymentRequired, completeBillingRestrictionResponse(*restriction, estimatedCost.CostCHF))
				}
				billingState = &state
			}
		}

		if params.GatewayClient == nil {
			params.Logger.Error("gateway client unavailable")
			return apis.NewApiError(http.StatusServiceUnavailable, "Provider is unavailable", nil)
		}

		openAIMessages := make([]oai.ChatCompletionMessage, 0, len(req.Messages))
		for _, message := range req.Messages {
			openAIMessages = append(openAIMessages, oai.ChatCompletionMessage{
				Role:    message.Role,
				Content: message.Content,
				Name:    message.Name,
			})
		}
		openAIMessages = compatopenai.AddSystemMessage(openAIMessages, agent)

		messages := make([]gateway.Message, 0, len(openAIMessages))
		for _, message := range openAIMessages {
			messages = append(messages, gateway.Message{
				Role:    message.Role,
				Content: message.Content,
				Name:    message.Name,
			})
		}

		var userMessageRecord *core.Record
		if shouldPersist {
			err, userMessageRecord = params.MessageRepo.EncryptAndPersistMessage(
				conversation,
				req.ParentMessageID,
				chat.MessageRecordData{
					OwnerID: owner.ID,
					Content: lastMessage.Content,
				},
			)
			if err != nil {
				params.Logger.Error("failed to save request message", "err", err)
				return apis.NewApiError(http.StatusInternalServerError, "Failed to save request message", err)
			}
		}

		gatewayStartedAt := time.Now()

		gatewayResp, err := params.GatewayClient.Complete(e.Request.Context(), gateway.CompleteRequest{
			ProviderID:      model.ProviderID,
			ProviderModelID: model.ProviderModelID,
			Messages:        messages,
			MaxOutputTokens: req.MaxOutputTokens,
		})
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
			return apis.NewApiError(http.StatusServiceUnavailable, "Failed to process completion", nil)
		}

		var assistantMessageRecord *core.Record
		if shouldPersist {
			err, assistantMessageRecord = params.MessageRepo.EncryptAndPersistMessage(
				conversation,
				userMessageRecord.Id,
				chat.MessageRecordData{
					Content: gatewayResp.Message.Content,
					AgentID: req.AgentID,
					ModelID: model.ID,
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
				AgentID:   req.AgentID,
				ModelID:   model.ID,
				CreatedAt: time.Now().UTC().Format(time.RFC3339),
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
		}
		if assistantMessageRecord != nil {
			response.AssistantMessage.ID = assistantMessageRecord.Id
		}
		if conversation.ExpiryDuration > 0 {
			response.ExpiresAt = time.Now().UTC().Add(conversation.ExpiryDuration).Format(time.RFC3339)
		}

		return e.JSON(http.StatusOK, response)
	}
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
