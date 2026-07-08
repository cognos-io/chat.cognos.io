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
	ReasoningEffort string              `json:"reasoning_effort,omitempty"`
	Persist         *bool               `json:"persist,omitempty"`
	// ContextSummary is a client-rendered compaction summary of older messages
	// (spec §9.2). It is folded into the canonical system prompt inside explicit
	// delimiters so summarised content is framed as reference material — never
	// injected as a synthetic assistant turn or a caller system message.
	ContextSummary string `json:"context_summary,omitempty"`
	// AttachmentIDs are user_attachments (library) records the caller owns and is
	// referencing from this message. The client embeds nothing in the encrypted
	// blob directly; the backend persists these as user_upload references and
	// records an attachment_usages row per (file, message) (spec §9.5).
	AttachmentIDs []string `json:"attachment_ids,omitempty"`
	// AttachmentContexts is the transient, plaintext attachment content for the
	// provider. It is wrapped as untrusted material, counted by the billing gate,
	// and never persisted or logged.
	AttachmentContexts []completionAttachmentInput `json:"attachment_contexts,omitempty"`
	// WebSearch opts this turn into provider-native web search. Nil (omitted)
	// means the default: on for search-capable models. The client sends an
	// explicit false to opt out. The tool is only ever sent for search-capable,
	// Requesty-routed models; it is silently dropped otherwise (never a 400).
	WebSearch *bool `json:"web_search,omitempty"`
}

// completionAttachmentInput is one attachment's transient provider context. It
// carries either extracted text (documents) or an inline image (vision models),
// never persisted.
type completionAttachmentInput struct {
	AttachmentID     string `json:"attachment_id"`
	MessageID        string `json:"message_id,omitempty"`
	DisplayName      string `json:"display_name"`
	DetectedMimeType string `json:"detected_mime_type"`
	ProcessorID      string `json:"processor_id"`
	TextContext      string `json:"text_context,omitempty"`
	ContextTruncated bool   `json:"context_truncated,omitempty"`
	// ImageBase64 is the model-ready image (base64, no data: prefix) for vision
	// models; ImageMimeType is its media type.
	ImageBase64   string `json:"image_base64,omitempty"`
	ImageMimeType string `json:"image_mime_type,omitempty"`
	// FileBase64 is a raw file (base64, no data: prefix) for models with native
	// file input (e.g. a PDF); FileMimeType/FileName describe it.
	FileBase64   string `json:"file_base64,omitempty"`
	FileMimeType string `json:"file_mime_type,omitempty"`
	FileName     string `json:"file_name,omitempty"`
}

type CompleteRequest = completeRequest

const maxSystemPromptChars = 20000

// requestyProviderID is the only provider that speaks the web-search tool
// (via its Responses API). The web-search gate never enables the tool for
// any other provider.
const requestyProviderID = "requesty"

// webSearchEnabledForModel is the server-side web-search gate. Web search is
// opt-out — nil (omitted) or an explicit true requests it — but it only ever
// reaches the provider for a search-capable, Requesty-routed model. Any other
// model silently drops the tool (never a 400), so switching to a non-capable
// model mid-conversation degrades gracefully (spec §4.3, §5.2).
func webSearchEnabledForModel(reqWebSearch *bool, model catalogue.Model) bool {
	requested := reqWebSearch == nil || *reqWebSearch
	return requested && model.SupportsWebSearch && model.ProviderID == requestyProviderID
}

// servedModelSnapshot captures the catalogue attributes of the resolved model
// that served a turn, so the persisted assistant message records what ACTUALLY
// served it (region/provider/tier) rather than relying on the live catalogue at
// render time. Catalogue metadata only — safe to store, never user content.
func servedModelSnapshot(model catalogue.Model) chat.ServedModel {
	return chat.ServedModel{
		ServedModelName:      model.Name,
		ServedProviderName:   model.ProviderName,
		ServedProviderID:     model.ProviderID,
		ServedPrivacyTier:    string(model.PrivacyTier),
		ServedHostingCountry: model.HostingCountry,
		ServedHostingRegion:  model.HostingRegion,
	}
}

// maxContextSummaryChars bounds the injected compaction summary independently of
// the system prompt so a long summary cannot be used to blow the prompt budget.
const maxContextSummaryChars = 12000

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
	ReasoningTokens          int64   `json:"reasoning_tokens"`
	CostUSD                  float64 `json:"cost_usd"`
	CostCHF                  float64 `json:"cost_chf"`
	CostRappen               int64   `json:"cost_rappen"`
	UsedProviderCost         bool    `json:"used_provider_cost"`
}

type assistantMessageResponse struct {
	ID              string `json:"id,omitempty"`
	ParentMessageID string `json:"parent_message_id,omitempty"`
	Content         string `json:"content"`
	// Reasoning is provider-returned reasoning text, omitted when the model
	// returns none. It is encrypted into the persisted message like Content.
	Reasoning string `json:"reasoning,omitempty"`
	PersonaID string `json:"persona_id"`
	ModelID   string `json:"model_id"`
	CreatedAt string `json:"created_at"`
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
	Type    string `json:"type"`
	Delta   string `json:"delta,omitempty"`
	Message string `json:"message,omitempty"`
	// Citations, CitationAnchors and SearchActivity ride on `web_search` events.
	// They are INCREMENTAL: Citations are only the sources newly seen on this
	// event (de-duplicated by URL upstream, with stable indices), CitationAnchors
	// reference those stable indices, and SearchActivity reports a lifecycle
	// transition. The client accumulates them across the stream.
	Citations       []citationPayload       `json:"citations,omitempty"`
	CitationAnchors []citationAnchorPayload `json:"citation_anchors,omitempty"`
	SearchActivity  string                  `json:"search_activity,omitempty"`
	Response        *completeResponse       `json:"response,omitempty"`
}

// citationPayload and citationAnchorPayload are the wire shapes for citations on
// the `web_search` SSE event and in the persisted MessageRecordData — identical
// keys so the client parses one shape for both.
type citationPayload struct {
	URL     string `json:"url"`
	Title   string `json:"title,omitempty"`
	Snippet string `json:"snippet,omitempty"`
}

type citationAnchorPayload struct {
	Citation int `json:"citation"`
	Start    int `json:"start"`
	End      int `json:"end"`
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
		req.ReasoningEffort = strings.TrimSpace(req.ReasoningEffort)
		req.ContextSummary = strings.TrimSpace(req.ContextSummary)

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
		if len(req.ContextSummary) > maxContextSummaryChars {
			return apis.NewBadRequestError("Context summary is too long", nil)
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
		if len(req.AttachmentIDs) > MaxAttachmentsPerMessage {
			return apis.NewBadRequestError("Too many attachments", nil)
		}
		attachmentContextChars := 0
		for i := range req.AttachmentContexts {
			attachmentContextChars += len(req.AttachmentContexts[i].TextContext)
		}
		if attachmentContextChars > maxAttachmentContextCharsPerMessage {
			return apis.NewBadRequestError("Attachment context is too long", nil)
		}

		model, ok, err := params.CatalogueService.GetModelByID(context.Background(), req.ModelID)
		if err != nil {
			params.Logger.Error("catalogue lookup failed", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load model", err)
		}
		if !ok || !model.IsActive {
			return apis.NewBadRequestError("Invalid model ID", nil)
		}

		// Image-generation-only models (e.g. gemini-2.5-flash-image) can't answer
		// a text completion. The composer gates this, but enforce server-side too
		// so a direct /complete call can't reach the provider with an image-only
		// model and fail there (capability bypass + clear error).
		if !model.SupportsTextCompletion {
			return apis.NewBadRequestError("This model can't be used for text completion", nil)
		}

		userTier := catalogue.NormalizePrivacyTier(e.Auth.GetString("privacy_tier"))
		if !catalogue.IsEligibleForTier(userTier, model.PrivacyTier) {
			return apis.NewForbiddenError("Model is not available for the user's privacy tier", nil)
		}

		// Only forward a reasoning effort the model actually declares — guards
		// against sending an unsupported parameter that a provider might reject.
		if !model.AcceptsReasoningEffort(req.ReasoningEffort) {
			return apis.NewBadRequestError("Reasoning effort is not supported for this model", nil)
		}

		// Web search is opt-out (default on when omitted) but only ever reaches the
		// provider for search-capable, Requesty-routed models. Otherwise the tool
		// is silently dropped — no 400 — so switching to a non-capable model
		// mid-conversation degrades gracefully (spec §4.3, §5.2). Computed here,
		// before the billing gate below, so the pre-call estimate can add a
		// worst-case search fee.
		enableWebSearch := webSearchEnabledForModel(req.WebSearch, model)

		// Image attachments require a vision-capable model. The UI gates this, but
		// enforce server-side too (capability bypass + clear error).
		attachmentImages, attachmentImageBytes := collectAttachmentImages(req.AttachmentContexts)
		if len(attachmentImages) > 0 {
			if !model.SupportsVision {
				return apis.NewBadRequestError("This model can't read images", nil)
			}
			if attachmentImageBytes > maxAttachmentImageBase64BytesPerMessage {
				return apis.NewBadRequestError("Attached images are too large", nil)
			}
		}

		// Raw file attachments (e.g. PDFs) require a model with native file input.
		attachmentFiles, attachmentFileBytes := collectAttachmentFiles(req.AttachmentContexts)
		if len(attachmentFiles) > 0 {
			if !model.SupportsFileInput {
				return apis.NewBadRequestError("This model can't read files", nil)
			}
			if attachmentFileBytes > maxAttachmentFileBase64BytesPerMessage {
				return apis.NewBadRequestError("Attached files are too large", nil)
			}
		}

		systemMessage := req.SystemPrompt
		if req.ContextSummary != "" {
			// Fold the compaction summary in after the canonical system prompt,
			// clearly delimited so a summarised "ignore previous instructions"
			// reads as quoted reference content, not a live directive (spec §11.1).
			systemMessage = req.SystemPrompt +
				"\n\n<conversation_summary>\n" + req.ContextSummary + "\n</conversation_summary>"
		}
		prompt := persona.Prompt{SystemMessage: systemMessage}

		// Wrap any attachment context as untrusted material and append it to the
		// user's turn (never the system prompt). Built before the estimate so the
		// billing gate counts attachment characters and cannot be bypassed by a
		// large attachment (spec §10.3).
		attachmentContextBlock := WrapAttachmentContexts(req.AttachmentContexts)
		effectiveMessages := req.Messages
		if attachmentContextBlock != "" {
			effectiveMessages = appendAttachmentContext(req.Messages, attachmentContextBlock)
		}

		// A realistic input estimate from the actual prompt, rather than assuming
		// the whole context window — so a short prompt to a large-context model is
		// not priced as if it filled a million tokens. Images add a flat per-image
		// estimate the char heuristic can't see.
		estimatedInputTokens := estimatePromptInputTokens(systemMessage, effectiveMessages, model) +
			int64(len(attachmentImages)*VisionImageInputTokenEstimate) +
			int64(len(attachmentFiles)*FileInputTokenEstimate)
		// The output we will actually allow the provider to generate. The billing
		// gate prices this exact ceiling (not the model's absolute max), and we
		// pass the same value to the provider so the response can never exceed
		// what we estimated — making the gate honest with no overspend risk. The
		// ceiling is plan-aware (refined once billing state is known below); the
		// baseline is conservative when billing is metered, generous otherwise.
		basePlan := billing.PlanTypeUnlimited
		if params.BillingStateRepo != nil && params.BillingService != nil {
			basePlan = billing.PlanTypeTrial
		}
		// The reasoning budget is sent explicitly and the output ceiling is floored
		// above it, so Anthropic's max_tokens > thinking.budget_tokens holds even on
		// the low trial ceiling. The raised ceiling is what the billing gate prices.
		effectiveMaxOutput, reasoningBudget := reasoningOutputPlan(req.MaxOutputTokens, model, basePlan, req.ReasoningEffort)

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

			// Reject references to attachments the caller does not own before any
			// provider work or persistence. A user may attach any file from their
			// own library to any conversation they participate in (spec §9.5).
			if len(req.AttachmentIDs) > 0 && params.App != nil {
				if err := verifyAttachmentsOwnedBy(params.App, owner.ID, req.AttachmentIDs); err != nil {
					return apis.NewBadRequestError("Invalid attachment reference", nil)
				}
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
				// Refine the output ceiling to the user's actual plan before gating
				// and before it is enforced on the provider request below.
				effectiveMaxOutput, reasoningBudget = reasoningOutputPlan(req.MaxOutputTokens, model, state.PlanType, req.ReasoningEffort)
				// Add one worst-case search fee to the estimate when web search
				// will be sent for this request, so the 402 gate stays honest
				// without over-blocking small balances on a turn that may not
				// end up searching at all (spec §5.4).
				estimatedSearchCount := int64(0)
				if enableWebSearch {
					estimatedSearchCount = 1
				}
				estimatedCost := params.BillingService.CalculateCost(model, billing.Usage{
					InputTokens:  estimatedInputTokens,
					OutputTokens: int64(effectiveMaxOutput),
					SearchCount:  estimatedSearchCount,
				}, completionUSDToCHFRate(params))
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

		personaMessages := make([]persona.Message, 0, len(effectiveMessages))
		for _, message := range effectiveMessages {
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

		// Attach inline images + raw files to the latest user turn so vision /
		// file-capable models receive them alongside the prompt and any text
		// attachment context.
		if len(messages) > 0 {
			if len(attachmentImages) > 0 {
				messages[len(messages)-1].Images = attachmentImages
			}
			if len(attachmentFiles) > 0 {
				messages[len(messages)-1].Files = attachmentFiles
			}
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
				userMessageData := chat.MessageRecordData{
					OwnerID:   owner.ID,
					Content:   lastMessage.Content,
					CreatedAt: time.Now().UTC().Format(time.RFC3339),
				}
				if len(req.AttachmentIDs) > 0 {
					// Embed encrypted references to the uploaded attachments. Only
					// the kind, record id and display mime type go into the
					// encrypted message; keys/filenames stay in the manifest.
					userMessageData.Attachments = buildUserUploadAttachments(req.AttachmentIDs, req.AttachmentContexts)
				}
				err, userMessageRecord = params.MessageRepo.EncryptAndPersistMessage(
					conversation,
					req.ParentMessageID,
					userMessageData,
				)
				if err != nil {
					params.Logger.Error("failed to save request message", "err", err)
					return apis.NewApiError(http.StatusInternalServerError, "Failed to save request message", err)
				}
				assistantParentID = userMessageRecord.Id

				// Record that this message references each library file, so the
				// library can show "used in chats" and a removed file leaves a
				// tombstone. Plaintext join rows only; best-effort.
				if len(req.AttachmentIDs) > 0 && params.App != nil {
					if err := recordAttachmentUsages(
						params.App,
						req.AttachmentIDs,
						conversationID,
						userMessageRecord.Id,
						owner.ID,
					); err != nil {
						params.Logger.Error("failed to record attachment usages", "err", err)
					}
				}
			}
		}

		// enableWebSearch was computed above, before the billing gate.
		gatewayStartedAt := time.Now()
		gatewayReq := gateway.CompleteRequest{
			ProviderID:         model.ProviderID,
			ProviderModelID:    model.ProviderModelID,
			Messages:           messages,
			MaxOutputTokens:    effectiveMaxOutput,
			ReasoningEffort:    req.ReasoningEffort,
			ReasoningMaxTokens: reasoningBudget,
			WebSearch:          enableWebSearch,
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

		// Web-search observability: counts only. Citation URLs/titles are message
		// content and must never be logged (same discipline as safeErrorSummary).
		if enableWebSearch && (gatewayResp.Usage.SearchCount > 0 || len(gatewayResp.Citations) > 0) {
			params.Logger.Info("completion used web search",
				"provider", model.ProviderID,
				"search_count", gatewayResp.Usage.SearchCount,
				"citation_count", len(gatewayResp.Citations),
			)
		}

		var assistantMessageRecord *core.Record
		if shouldPersist {
			err, assistantMessageRecord = params.MessageRepo.EncryptAndPersistMessage(
				conversation,
				assistantParentID,
				chat.MessageRecordData{
					Content:         gatewayResp.Message.Content,
					Reasoning:       gatewayResp.Reasoning,
					PersonaID:       req.PersonaID,
					ModelID:         model.ID,
					ServedModel:     servedModelSnapshot(model),
					CreatedAt:       assistantCreatedAt,
					InputTokens:     gatewayResp.Usage.InputTokens,
					OutputTokens:    gatewayResp.Usage.OutputTokens,
					Citations:       toMessageCitations(gatewayResp.Citations),
					CitationAnchors: toMessageCitationAnchors(gatewayResp.CitationAnchors),
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
			SearchCount:              int64(gatewayResp.Usage.SearchCount),
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
					SearchCount:  int64(gatewayResp.Usage.SearchCount),
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
				Reasoning: gatewayResp.Reasoning,
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
				ReasoningTokens:          gatewayResp.Usage.ReasoningTokens,
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
	}, func(reasoning string) error {
		return writeCompleteStreamEvent(e, completeStreamResponse{
			Type:  "reasoning_delta",
			Delta: reasoning,
		})
	}, func(citations []gateway.Citation, anchors []gateway.CitationAnchor, activity string) error {
		return writeCompleteStreamEvent(e, completeStreamResponse{
			Type:            "web_search",
			Citations:       toCitationPayloads(citations),
			CitationAnchors: toCitationAnchorPayloads(anchors),
			SearchActivity:  activity,
		})
	}, func() error {
		return writeCompleteStreamHeartbeat(e)
	}, func(err error) {
		params.Logger.Info("client disconnected during completion stream", "err", err)
	})
}

// toCitationPayloads / toCitationAnchorPayloads convert the gateway-neutral
// citation types to the SSE/persistence wire shape.
func toCitationPayloads(citations []gateway.Citation) []citationPayload {
	if len(citations) == 0 {
		return nil
	}
	out := make([]citationPayload, 0, len(citations))
	for _, c := range citations {
		out = append(out, citationPayload{URL: c.URL, Title: c.Title, Snippet: c.Snippet})
	}
	return out
}

func toCitationAnchorPayloads(anchors []gateway.CitationAnchor) []citationAnchorPayload {
	if len(anchors) == 0 {
		return nil
	}
	out := make([]citationAnchorPayload, 0, len(anchors))
	for _, a := range anchors {
		out = append(out, citationAnchorPayload{Citation: a.CitationIndex, Start: a.StartIndex, End: a.EndIndex})
	}
	return out
}

// toMessageCitations / toMessageCitationAnchors convert the gateway-neutral
// citation types to the persisted MessageRecordData shape. Citations are message
// content — encrypted at rest, never logged.
func toMessageCitations(citations []gateway.Citation) []chat.MessageCitation {
	if len(citations) == 0 {
		return nil
	}
	out := make([]chat.MessageCitation, 0, len(citations))
	for _, c := range citations {
		out = append(out, chat.MessageCitation{URL: c.URL, Title: c.Title, Snippet: c.Snippet})
	}
	return out
}

func toMessageCitationAnchors(anchors []gateway.CitationAnchor) []chat.MessageCitationAnchor {
	if len(anchors) == 0 {
		return nil
	}
	out := make([]chat.MessageCitationAnchor, 0, len(anchors))
	for _, a := range anchors {
		out = append(out, chat.MessageCitationAnchor{Citation: a.CitationIndex, Start: a.StartIndex, End: a.EndIndex})
	}
	return out
}

func collectGatewayStream(
	ctx context.Context,
	client gateway.Client,
	req gateway.CompleteRequest,
	onDelta func(string) error,
	onReasoning func(string) error,
	onWebSearch func([]gateway.Citation, []gateway.CitationAnchor, string) error,
	onHeartbeat func() error,
	onClientDisconnect func(error),
) (gateway.CompleteResponse, bool, bool, error) {
	return collectGatewayStreamWithHeartbeat(
		ctx,
		client,
		req,
		onDelta,
		onReasoning,
		onWebSearch,
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
	onReasoning func(string) error,
	onWebSearch func([]gateway.Citation, []gateway.CitationAnchor, string) error,
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
	var reasoningBuilder strings.Builder
	usage := gateway.Usage{}
	// Citations/anchors arrive incrementally and already de-duplicated by URL
	// with stable indices, so appending in arrival order yields the final
	// ordered set the assistant message persists.
	var citations []gateway.Citation
	var citationAnchors []gateway.CitationAnchor
	clientDisconnected := false

	finalResponse := func() gateway.CompleteResponse {
		return gateway.CompleteResponse{
			Message: gateway.Message{
				Role:    "assistant",
				Content: builder.String(),
			},
			Reasoning:       reasoningBuilder.String(),
			Citations:       citations,
			CitationAnchors: citationAnchors,
			Usage:           usage,
		}
	}

	for {
		select {
		case <-ctx.Done():
			return finalResponse(), clientDisconnected, true, nil
		case <-heartbeatC:
			if !clientDisconnected {
				if err := onHeartbeat(); err != nil {
					clientDisconnected = true
					onClientDisconnect(err)
				}
			}
		case event, ok := <-stream:
			if !ok {
				return finalResponse(), clientDisconnected, false, nil
			}
			if event.Err != nil {
				return gateway.CompleteResponse{}, clientDisconnected, false, event.Err
			}
			if event.ReasoningDelta != "" {
				reasoningBuilder.WriteString(event.ReasoningDelta)
				if !clientDisconnected && onReasoning != nil {
					if err := onReasoning(event.ReasoningDelta); err != nil {
						clientDisconnected = true
						onClientDisconnect(err)
					}
				}
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
			if len(event.Citations) > 0 || len(event.CitationAnchors) > 0 || event.SearchActivity != "" {
				citations = append(citations, event.Citations...)
				citationAnchors = append(citationAnchors, event.CitationAnchors...)
				if !clientDisconnected && onWebSearch != nil {
					if err := onWebSearch(event.Citations, event.CitationAnchors, event.SearchActivity); err != nil {
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

// Per-plan default output ceilings, applied when the caller does not request a
// specific limit. They bound per-call cost (keeping the billing gate affordable
// for expensive/large-context models); paid plans get a higher ceiling for
// longer single responses. Always clamped to the model's own maximum.
const (
	defaultMaxOutputTokens = 8192  // trial / inactive / unknown
	paidMaxOutputTokens    = 32768 // payg / unlimited
)

// outputCapForPlan returns the default output ceiling for a plan. Paid plans
// (pay-as-you-go and unlimited) get the higher cap.
func outputCapForPlan(plan billing.PlanType) int {
	switch plan {
	case billing.PlanTypePayG, billing.PlanTypeUnlimited:
		return paidMaxOutputTokens
	default:
		return defaultMaxOutputTokens
	}
}

// Reasoning-budget bounds. We send the thinking budget explicitly (rather than
// letting the router derive one from the effort tier) so we can guarantee
// Anthropic's invariant: max_tokens must be strictly greater than
// thinking.budget_tokens. reasoningAnswerHeadroomTokens reserves room for the
// visible answer once thinking is spent; minThinkingBudgetTokens is Anthropic's
// floor for extended thinking.
const (
	reasoningAnswerHeadroomTokens = 4096
	minThinkingBudgetTokens       = 1024
)

// reasoningBudgetTokens maps a reasoning effort tier to an explicit thinking
// budget. It returns 0 when reasoning is disabled ("off"/"none"/empty). The
// effort is assumed already validated against the model (see
// AcceptsReasoningEffort); an unrecognised tier falls back to the medium budget.
func reasoningBudgetTokens(effort string) int {
	switch strings.ToLower(strings.TrimSpace(effort)) {
	case "", "off", "none":
		return 0
	case "minimal", "low":
		return 4096
	case "medium":
		return 8192
	case "high":
		return 16384
	default:
		return 8192
	}
}

// reasoningOutputPlan resolves the output ceiling and explicit thinking budget
// for a completion. The ceiling is what the billing gate prices and what we
// enforce on the provider; the budget is the thinking allowance we send. When
// reasoning is enabled the ceiling is floored above budget+answer-headroom so
// Anthropic's max_tokens > thinking.budget_tokens always holds, and the budget
// is shrunk if the model's own maximum can't hold budget+headroom. budget is 0
// when reasoning is off, in which case the ceiling is the plain plan default.
func reasoningOutputPlan(requested int, model catalogue.Model, plan billing.PlanType, effort string) (maxOutput, reasoningBudget int) {
	maxOutput = effectiveMaxOutputTokens(requested, model, plan)

	budget := reasoningBudgetTokens(effort)
	if budget == 0 {
		return maxOutput, 0
	}

	// Raise the ceiling so the budget plus room for the answer fits, then clamp
	// to the model's own maximum.
	if needed := budget + reasoningAnswerHeadroomTokens; needed > maxOutput {
		maxOutput = needed
	}
	if model.MaxOutputTokens > 0 && maxOutput > model.MaxOutputTokens {
		maxOutput = model.MaxOutputTokens
	}

	// Keep the budget strictly below max_tokens even when the model's ceiling is
	// too small to hold the full budget+headroom.
	if budget > maxOutput-reasoningAnswerHeadroomTokens {
		budget = maxOutput - reasoningAnswerHeadroomTokens
	}
	if budget < minThinkingBudgetTokens {
		budget = minThinkingBudgetTokens
	}
	if budget >= maxOutput {
		budget = maxOutput - 1
	}

	return maxOutput, budget
}

// effectiveMaxOutputTokens is the output ceiling we both gate on and enforce at
// the provider: the caller's request when given, otherwise the plan default,
// always clamped to the model's own maximum.
func effectiveMaxOutputTokens(requested int, model catalogue.Model, plan billing.PlanType) int {
	out := requested
	if out <= 0 {
		out = outputCapForPlan(plan)
	}
	if model.MaxOutputTokens > 0 && out > model.MaxOutputTokens {
		out = model.MaxOutputTokens
	}
	return out
}

// appendAttachmentContext returns a copy of messages with the wrapped
// attachment block appended to the final (user) turn. The original message
// content persisted to the conversation is unchanged — the block is transient
// provider context only.
func appendAttachmentContext(messages []completionMessage, block string) []completionMessage {
	out := make([]completionMessage, len(messages))
	copy(out, messages)
	last := len(out) - 1
	out[last].Content = out[last].Content + "\n\n" + block
	return out
}

// estimatePromptInputTokens approximates the prompt's input tokens from the
// actual system prompt + messages, using the model's chars-per-token heuristic.
// Used by the billing gate so a short prompt is not priced as the full context
// window.
func estimatePromptInputTokens(
	systemMessage string,
	messages []completionMessage,
	model catalogue.Model,
) int64 {
	chars := len(systemMessage)
	for _, message := range messages {
		chars += len(message.Content)
	}
	charsPerToken := model.CharsPerToken()
	if charsPerToken <= 0 {
		charsPerToken = catalogue.DefaultApproxCharsPerToken
	}
	return int64(chars/charsPerToken) + 1
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
