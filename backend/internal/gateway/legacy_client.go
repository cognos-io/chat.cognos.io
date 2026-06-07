package gateway

import (
	"context"
	"fmt"
	"net/http/httptest"

	"github.com/cognos-io/chat.cognos.io/backend/pkg/proxy"
	"github.com/pocketbase/pocketbase/core"
	oai "github.com/sashabaranov/go-openai"
)

type LegacyClient struct {
	UpstreamRepo proxy.UpstreamRepo
}

func NewLegacyClient(upstreamRepo proxy.UpstreamRepo) *LegacyClient {
	return &LegacyClient{UpstreamRepo: upstreamRepo}
}

func (c *LegacyClient) Complete(ctx context.Context, req CompleteRequest) (CompleteResponse, error) {
	if c == nil || c.UpstreamRepo == nil {
		return CompleteResponse{}, fmt.Errorf("gateway upstream repo is not configured")
	}

	upstream, err := c.UpstreamRepo.Provider(req.ProviderID)
	if err != nil {
		return CompleteResponse{}, err
	}

	messages := make([]oai.ChatCompletionMessage, 0, len(req.Messages))
	for _, message := range req.Messages {
		messages = append(messages, oai.ChatCompletionMessage{
			Role:    message.Role,
			Content: message.Content,
			Name:    message.Name,
		})
	}

	event := &core.RequestEvent{}
	event.Request = httptest.NewRequest("POST", "/", nil).WithContext(ctx)
	event.Response = httptest.NewRecorder()

	upstreamResp, plainTextResponseMessage, err := upstream.ChatCompletion(event, oai.ChatCompletionRequest{
		Model:     req.ProviderModelID,
		Messages:  messages,
		MaxTokens: req.MaxOutputTokens,
	})
	if err != nil {
		return CompleteResponse{}, err
	}

	return CompleteResponse{
		Message: Message{
			Role:    "assistant",
			Content: plainTextResponseMessage,
		},
		Usage: Usage{
			InputTokens:  int64(upstreamResp.Usage.PromptTokens),
			OutputTokens: int64(upstreamResp.Usage.CompletionTokens),
			TotalTokens:  int64(upstreamResp.Usage.TotalTokens),
		},
	}, nil
}
