package proxy

import (
	"github.com/labstack/echo/v5"
	"github.com/sashabaranov/go-openai"
)

// Upstream is an interface that defines the methods that an upstream server must implement
type Upstream interface {
	// LookupModel maps our internal model names to the upstream model names
	LookupModel(internalModel string) (string, error)
	// ChatCompletion sends a request to the upstream server to complete a chat prompt
	// and returns the response
	ChatCompletion(
		c echo.Context,
		request openai.ChatCompletionRequest,
	) (response openai.ChatCompletionResponse, plainTextRequestMessage string, err error)
	// ChatCompletionStream sends a request to the upstream server to complete a chat prompt
	// and returns the response in a streaming fashion
	ChatCompletionStream(
		c echo.Context,
		request openai.ChatCompletionRequest,
	) (response openai.ChatCompletionStreamResponse, plainTextRequestMessage string, err error)
}
