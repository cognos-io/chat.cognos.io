package proxy

import (
	"errors"

	"github.com/pocketbase/pocketbase/core"
	"github.com/sashabaranov/go-openai"
)

var ErrNoRetentionUnsupported = errors.New("provider does not guarantee no retention")

// Upstream is an interface that defines the methods that an upstream server must implement
type Upstream interface {
	// LookupModel maps our internal model names to the upstream model names
	LookupModel(internalModel string) (string, error)
	// EnsureNoRetention verifies that the provider satisfies the no-retention requirement.
	EnsureNoRetention() error
	// ChatCompletion sends a request to the upstream server to complete a chat prompt
	// and returns the response
	ChatCompletion(
		e *core.RequestEvent,
		request openai.ChatCompletionRequest,
	) (response openai.ChatCompletionResponse, plainTextRequestMessage string, err error)
}
