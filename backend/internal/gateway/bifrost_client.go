package gateway

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
)

type bifrostRequester interface {
	ChatCompletionRequest(ctx *schemas.BifrostContext, req *schemas.BifrostChatRequest) (*schemas.BifrostChatResponse, *schemas.BifrostError)
	ChatCompletionStreamRequest(ctx *schemas.BifrostContext, req *schemas.BifrostChatRequest) (chan *schemas.BifrostStreamChunk, *schemas.BifrostError)
	ImageGenerationRequest(ctx *schemas.BifrostContext, req *schemas.BifrostImageGenerationRequest) (*schemas.BifrostImageGenerationResponse, *schemas.BifrostError)
}

type bifrostShutdowner interface {
	Shutdown()
}

type BifrostClient struct {
	requester bifrostRequester
	shutdown  bifrostShutdowner
	account   schemas.Account
	logger    *slog.Logger
}

func NewBifrostClient(
	requester bifrostRequester,
	shutdown bifrostShutdowner,
	account schemas.Account,
	logger *slog.Logger,
) *BifrostClient {
	return &BifrostClient{
		requester: requester,
		shutdown:  shutdown,
		account:   account,
		logger:    logger,
	}
}

func NewConfiguredBifrostClient(account schemas.Account, logLevel string, logger *slog.Logger) (*BifrostClient, error) {
	if account == nil {
		return nil, fmt.Errorf("bifrost account is required")
	}

	runtime, err := bifrost.Init(context.Background(), schemas.BifrostConfig{
		Account:         account,
		InitialPoolSize: schemas.DefaultInitialPoolSize,
		Logger:          bifrost.NewDefaultLogger(parseBifrostLogLevel(logLevel)),
	})
	if err != nil {
		return nil, err
	}

	return NewBifrostClient(runtime, runtime, account, logger), nil
}

func (c *BifrostClient) Shutdown() {
	if c == nil || c.shutdown == nil {
		return
	}
	c.shutdown.Shutdown()
}

func (c *BifrostClient) Account() schemas.Account {
	if c == nil {
		return nil
	}
	return c.account
}

func (c *BifrostClient) Complete(ctx context.Context, req CompleteRequest) (CompleteResponse, error) {
	if c == nil || c.requester == nil {
		return CompleteResponse{}, fmt.Errorf("bifrost client is not configured")
	}

	chatReq, err := c.buildChatRequest(req)
	if err != nil {
		return CompleteResponse{}, err
	}

	bifrostCtx := schemas.NewBifrostContext(ctx, schemas.NoDeadline)
	resp, bifrostErr := c.requester.ChatCompletionRequest(bifrostCtx, chatReq)
	if bifrostErr != nil {
		c.logBifrostError(req, bifrostErr)
		return CompleteResponse{}, fmt.Errorf("bifrost request failed: %s", safeErrorSummary(bifrostErr))
	}
	if resp == nil {
		return CompleteResponse{}, fmt.Errorf("bifrost returned nil response")
	}
	if len(resp.Choices) == 0 {
		return CompleteResponse{}, fmt.Errorf("bifrost returned no completion choices")
	}

	message := resp.Choices[0].Message
	if message == nil {
		return CompleteResponse{}, fmt.Errorf("bifrost returned an empty completion message")
	}

	content := extractMessageContent(message)
	usage := resp.Usage
	if usage == nil {
		usage = &schemas.BifrostLLMUsage{}
	}

	var providerCostUSD *float64
	if usage.Cost != nil {
		totalCost := usage.Cost.TotalCost
		providerCostUSD = &totalCost
	}

	return CompleteResponse{
		Message: Message{
			Role:    string(message.Role),
			Content: content,
		},
		Reasoning: extractReasoning(message),
		Usage: Usage{
			InputTokens:              int64(usage.PromptTokens),
			OutputTokens:             int64(usage.CompletionTokens),
			TotalTokens:              int64(usage.TotalTokens),
			CacheCreationInputTokens: int64(cachedWriteTokens(usage)),
			CacheReadInputTokens:     int64(cachedReadTokens(usage)),
			ReasoningTokens:          int64(reasoningTokens(usage)),
			ProviderCostUSD:          providerCostUSD,
		},
	}, nil
}

func (c *BifrostClient) CompleteStream(ctx context.Context, req CompleteRequest) (<-chan CompleteStreamEvent, error) {
	if c == nil || c.requester == nil {
		return nil, fmt.Errorf("bifrost client is not configured")
	}

	chatReq, err := c.buildChatRequest(req)
	if err != nil {
		return nil, err
	}

	bifrostCtx := schemas.NewBifrostContext(ctx, schemas.NoDeadline)
	stream, bifrostErr := c.requester.ChatCompletionStreamRequest(bifrostCtx, chatReq)
	if bifrostErr != nil {
		c.logBifrostError(req, bifrostErr)
		return nil, fmt.Errorf("bifrost request failed: %s", safeErrorSummary(bifrostErr))
	}
	if stream == nil {
		return nil, fmt.Errorf("bifrost returned nil stream")
	}

	out := make(chan CompleteStreamEvent)
	go func() {
		defer close(out)

		for chunk := range stream {
			if chunk == nil {
				continue
			}
			if chunk.BifrostError != nil {
				c.logBifrostError(req, chunk.BifrostError)
				out <- CompleteStreamEvent{Err: fmt.Errorf("bifrost request failed: %s", safeErrorSummary(chunk.BifrostError))}
				return
			}
			if chunk.BifrostChatResponse == nil {
				continue
			}

			event := CompleteStreamEvent{}
			if usage := chunk.BifrostChatResponse.Usage; usage != nil {
				providerCostUSD := (*float64)(nil)
				if usage.Cost != nil {
					totalCost := usage.Cost.TotalCost
					providerCostUSD = &totalCost
				}
				event.Usage = &Usage{
					InputTokens:              int64(usage.PromptTokens),
					OutputTokens:             int64(usage.CompletionTokens),
					TotalTokens:              int64(usage.TotalTokens),
					CacheCreationInputTokens: int64(cachedWriteTokens(usage)),
					CacheReadInputTokens:     int64(cachedReadTokens(usage)),
					ReasoningTokens:          int64(reasoningTokens(usage)),
					ProviderCostUSD:          providerCostUSD,
				}
			}

			for _, choice := range chunk.BifrostChatResponse.Choices {
				delta := choice.ChatStreamResponseChoice
				if delta == nil || delta.Delta == nil {
					continue
				}
				if delta.Delta.Content != nil {
					event.Delta += *delta.Delta.Content
				}
				if delta.Delta.Reasoning != nil {
					event.ReasoningDelta += *delta.Delta.Reasoning
				}
			}

			if event.Delta == "" && event.ReasoningDelta == "" && event.Usage == nil {
				continue
			}

			out <- event
		}
	}()

	return out, nil
}

func (c *BifrostClient) buildChatRequest(req CompleteRequest) (*schemas.BifrostChatRequest, error) {
	if strings.TrimSpace(req.ProviderID) == "" {
		return nil, fmt.Errorf("bifrost provider id is required")
	}
	if strings.TrimSpace(req.ProviderModelID) == "" {
		return nil, fmt.Errorf("bifrost model id is required")
	}

	messages := make([]schemas.ChatMessage, 0, len(req.Messages))
	for _, message := range req.Messages {
		content := message.Content
		name := strings.TrimSpace(message.Name)
		messages = append(messages, schemas.ChatMessage{
			Name:    nullableString(name),
			Role:    schemas.ChatMessageRole(message.Role),
			Content: buildMessageContent(content, message.Images, message.Files),
		})
	}

	chatReq := &schemas.BifrostChatRequest{
		Provider: schemas.ModelProvider(req.ProviderID),
		Model:    req.ProviderModelID,
		Input:    messages,
	}
	if req.MaxOutputTokens > 0 || req.ReasoningEffort != "" || req.JSONResponseFormat {
		chatReq.Params = &schemas.ChatParameters{}
	}
	if req.MaxOutputTokens > 0 {
		chatReq.Params.MaxCompletionTokens = &req.MaxOutputTokens
	}
	if reasoning := reasoningParam(req.ReasoningEffort); reasoning != nil {
		// Send the thinking budget explicitly (Anthropic's thinking.budget_tokens)
		// so we own the max_tokens > budget invariant rather than depending on the
		// router's effort→budget mapping. reasoningParam only returns non-nil for
		// an enabled tier, so a budget here is always for active reasoning.
		if req.ReasoningMaxTokens > 0 {
			budget := req.ReasoningMaxTokens
			reasoning.MaxTokens = &budget
		}
		chatReq.Params.Reasoning = reasoning
	}
	if req.JSONResponseFormat {
		// OpenAI-compatible JSON mode. Bifrost passes this through to the
		// provider; providers that don't support it ignore it, so the caller must
		// still tolerate non-JSON output.
		var responseFormat interface{} = map[string]string{"type": "json_object"}
		chatReq.Params.ResponseFormat = &responseFormat
	}

	return chatReq, nil
}

// reasoningParam translates a user-selected effort into Bifrost's reasoning
// parameter. Empty AND the disabling tiers ("off"/"none") return nil, so NO
// reasoning parameter is sent — that is the portable, OpenAI-compatible way to
// request no extended thinking.
//
// We must NOT send effort "none" to disable: Requesty is a Bifrost custom
// provider, which skips reasoning normalisation and forwards the param verbatim.
// Requesty/Bedrock then reads the mere presence of a reasoning param as
// "thinking on" and applies a default budget — so "none" actually ENABLES
// thinking, and a small max_tokens (e.g. title generation's ~15) trips
// Anthropic's "max_tokens > thinking.budget_tokens" 400. Omitting the param
// leaves Claude at its thinking-off default. Every other tier passes through
// verbatim.
func reasoningParam(effort string) *schemas.ChatReasoning {
	switch strings.ToLower(strings.TrimSpace(effort)) {
	case "", "off", "none":
		return nil
	default:
		return &schemas.ChatReasoning{Effort: &effort}
	}
}

// buildMessageContent renders a gateway message into Bifrost content. With no
// images or files it stays a plain string; otherwise it becomes multimodal
// content blocks (an optional text block, then image_url data-URL blocks, then
// file data-URL blocks).
func buildMessageContent(
	content string,
	images []MessageImage,
	files []MessageFile,
) *schemas.ChatMessageContent {
	if len(images) == 0 && len(files) == 0 {
		text := content
		return &schemas.ChatMessageContent{ContentStr: &text}
	}

	blocks := make([]schemas.ChatContentBlock, 0, len(images)+len(files)+1)
	if content != "" {
		text := content
		blocks = append(blocks, schemas.ChatContentBlock{
			Type: schemas.ChatContentBlockTypeText,
			Text: &text,
		})
	}
	for _, image := range images {
		dataURL := "data:" + image.MimeType + ";base64," + image.Base64
		blocks = append(blocks, schemas.ChatContentBlock{
			Type:           schemas.ChatContentBlockTypeImage,
			ImageURLStruct: &schemas.ChatInputImage{URL: dataURL},
		})
	}
	for _, file := range files {
		dataURL := "data:" + file.MimeType + ";base64," + file.Base64
		filename := file.Filename
		fileType := file.MimeType
		blocks = append(blocks, schemas.ChatContentBlock{
			Type: schemas.ChatContentBlockTypeFile,
			File: &schemas.ChatInputFile{
				FileData: &dataURL,
				Filename: &filename,
				FileType: &fileType,
			},
		})
	}
	return &schemas.ChatMessageContent{ContentBlocks: blocks}
}

func extractMessageContent(message *schemas.ChatMessage) string {
	if message == nil || message.Content == nil {
		return ""
	}
	if message.Content.ContentStr != nil {
		return *message.Content.ContentStr
	}

	var builder strings.Builder
	for _, block := range message.Content.ContentBlocks {
		if block.Text != nil {
			builder.WriteString(*block.Text)
		}
	}
	return builder.String()
}

// extractReasoning returns the provider-normalised reasoning text for an
// assistant message, or "" when the model exposes none. Bifrost folds the
// provider-specific shapes (OpenAI "reasoning", xAI "reasoning_content",
// DeepSeek thinking) into the single ChatAssistantMessage.Reasoning field.
func extractReasoning(message *schemas.ChatMessage) string {
	if message == nil || message.ChatAssistantMessage == nil || message.Reasoning == nil {
		return ""
	}
	return *message.Reasoning
}

func reasoningTokens(usage *schemas.BifrostLLMUsage) int {
	if usage == nil || usage.CompletionTokensDetails == nil {
		return 0
	}
	return usage.CompletionTokensDetails.ReasoningTokens
}

func cachedReadTokens(usage *schemas.BifrostLLMUsage) int {
	if usage == nil || usage.PromptTokensDetails == nil {
		return 0
	}
	return usage.PromptTokensDetails.CachedReadTokens
}

func cachedWriteTokens(usage *schemas.BifrostLLMUsage) int {
	if usage == nil || usage.PromptTokensDetails == nil {
		return 0
	}
	if usage.PromptTokensDetails.CachedWriteTokenDetails != nil {
		return usage.PromptTokensDetails.CachedWriteTokenDetails.CachedWriteTokens5m +
			usage.PromptTokensDetails.CachedWriteTokenDetails.CachedWriteTokens1h
	}
	return usage.PromptTokensDetails.CachedWriteTokens
}

func (c *BifrostClient) logBifrostError(req CompleteRequest, bifrostErr *schemas.BifrostError) {
	c.logProviderError(req.ProviderID, req.ProviderModelID, bifrostErr)
}

// logProviderError logs a provider failure using only structured, non-sensitive
// fields (provider, model, status/type/code). It deliberately never logs the
// prompt, the free-text error message, or any generated content.
func (c *BifrostClient) logProviderError(providerID, modelID string, bifrostErr *schemas.BifrostError) {
	if c == nil || c.logger == nil || bifrostErr == nil {
		return
	}

	attrs := []any{
		"provider", strings.TrimSpace(providerID),
		"model", strings.TrimSpace(modelID),
		"status_code", derefInt(bifrostErr.StatusCode),
		"error_type", derefString(bifrostErrorType(bifrostErr)),
		"error_code", derefString(bifrostErrorCode(bifrostErr)),
		"original_model_requested", bifrostErr.ExtraFields.OriginalModelRequested,
		"resolved_model_used", bifrostErr.ExtraFields.ResolvedModelUsed,
	}
	c.logger.Error("bifrost request failed", attrs...)
}

// ClampBifrostLogLevel bounds the bifrost log level so it is never more
// verbose than "warn" outside dev mode: the upstream library may log request
// bodies — i.e. plaintext prompts — at debug/info, and Cognos never logs user
// content. Returns the effective level and whether it was clamped (so the
// caller can log a warning). Unrecognised/empty levels pass through untouched;
// parseBifrostLogLevel already defaults those to "error".
func ClampBifrostLogLevel(level string, devMode bool) (string, bool) {
	if devMode {
		return level, false
	}
	switch strings.ToLower(strings.TrimSpace(level)) {
	case string(schemas.LogLevelDebug), string(schemas.LogLevelInfo):
		return string(schemas.LogLevelWarn), true
	default:
		return level, false
	}
}

func parseBifrostLogLevel(level string) schemas.LogLevel {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case string(schemas.LogLevelDebug):
		return schemas.LogLevelDebug
	case string(schemas.LogLevelInfo):
		return schemas.LogLevelInfo
	case string(schemas.LogLevelWarn):
		return schemas.LogLevelWarn
	default:
		return schemas.LogLevelError
	}
}

func bifrostErrorType(bifrostErr *schemas.BifrostError) *string {
	if bifrostErr == nil || bifrostErr.Error == nil {
		return nil
	}
	return bifrostErr.Error.Type
}

func bifrostErrorCode(bifrostErr *schemas.BifrostError) *string {
	if bifrostErr == nil || bifrostErr.Error == nil {
		return nil
	}
	return bifrostErr.Error.Code
}

// safeErrorSummary describes a provider failure using only structured,
// provider-defined fields (status, type, code). It deliberately omits the
// free-text Error.Message: some providers echo parts of the request — and
// therefore plaintext user content — back in that field. Cognos never logs or
// propagates user data, so the message must not reach logs or wrapped errors.
func safeErrorSummary(bifrostErr *schemas.BifrostError) string {
	if bifrostErr == nil {
		return "unknown error"
	}

	parts := make([]string, 0, 3)
	if bifrostErr.StatusCode != nil {
		parts = append(parts, fmt.Sprintf("status=%d", *bifrostErr.StatusCode))
	}
	if errorType := derefString(bifrostErrorType(bifrostErr)); errorType != "" {
		parts = append(parts, "type="+errorType)
	}
	if errorCode := derefString(bifrostErrorCode(bifrostErr)); errorCode != "" {
		parts = append(parts, "code="+errorCode)
	}
	if len(parts) == 0 {
		return "unspecified provider error"
	}
	return strings.Join(parts, " ")
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func derefInt(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
