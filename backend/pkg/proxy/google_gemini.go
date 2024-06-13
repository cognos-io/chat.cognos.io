package proxy

import (
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/generative-ai-go/genai"
	"github.com/labstack/echo/v5"
	"github.com/sashabaranov/go-openai"
)

// Maps from our internal model names to the model names used by Google
// Model list: https://ai.google.dev/gemini-api/docs/models/gemini
var googleGeminiAIModelMapping = map[string]string{
	"gemini-1.5-pro":   "models/gemini-1.5-pro",
	"gemini-1.5-flash": "models/gemini-1.5-flash",
}

var googleGeminiFinishReasonToOpenAI = map[genai.FinishReason]openai.FinishReason{
	genai.FinishReasonUnspecified: openai.FinishReasonNull,
	genai.FinishReasonStop:        openai.FinishReasonStop,
	genai.FinishReasonMaxTokens:   openai.FinishReasonLength,
	genai.FinishReasonSafety:      openai.FinishReasonContentFilter,
	genai.FinishReasonRecitation:  openai.FinishReasonContentFilter,
	genai.FinishReasonOther:       openai.FinishReasonNull,
}

type GoogleGemini struct {
	client *genai.Client
	logger *slog.Logger
}

func (g *GoogleGemini) LookupModel(
	internalModel string,
) (string, error) {
	// Google doesn't just use strings as model names, instead requires a genai.GenerativeModel struct
	// Here we validate if the model name is valid and then return the corresponding google model name
	return GoogleGeminiModelMapper(internalModel)
}

func (g *GoogleGemini) ChatCompletion(
	c echo.Context,
	req openai.ChatCompletionRequest,
) (response openai.ChatCompletionResponse, plainTextResponseMessage string, err error) {
	model := g.client.GenerativeModel(req.Model)

	cs := model.StartChat()
	cs.History = []*genai.Content{}

	for idx, message := range req.Messages {

		if idx == len(req.Messages)-1 {
			// Skip the last message as it will be sent as the main message
			break
		}

		content := genai.Content{
			Parts: []genai.Part{
				genai.Text(message.Content),
			},
		}

		if message.Role == "system" {
			model.SystemInstruction = &content
			continue
		}

		if message.Role == "user" {
			content.Role = "user"
		}

		if message.Role == "assistant" {
			content.Role = "model"
		}

		cs.History = append(cs.History, &content)
	}

	if req.Stream {
		// TODO(ewan): Implement streaming
	}

	resp, err := cs.SendMessage(
		c.Request().Context(),
		// Send the last message as the main message
		genai.Text(req.Messages[len(req.Messages)-1].Content),
	)
	if err != nil {
		return openai.ChatCompletionResponse{}, "", err
	}

	if resp.Candidates == nil {
		// Assume this was filtered due to safety concerns
		// TODO(ewan): Handle this better
		return openai.ChatCompletionResponse{}, "", fmt.Errorf("no candidates returned")
	}

	sb := strings.Builder{}

	for _, cand := range resp.Candidates {
		if cand.Content != nil {
			for _, part := range cand.Content.Parts {
				sb.WriteString(fmt.Sprint(part))
			}
		}
	}

	return GeminiResponseToOpenAIResponse(resp), sb.String(), nil
}

func NewGoogleGemini(
	client *genai.Client,
	logger *slog.Logger,
) (*GoogleGemini, error) {
	return &GoogleGemini{
		logger: logger,
		client: client,
	}, nil
}

func GoogleGeminiModelMapper(model string) (string, error) {
	if mappedModel, ok := googleGeminiAIModelMapping[model]; ok {
		return mappedModel, nil
	}
	return "", fmt.Errorf("invalid model name: %s", model)
}

func GeminiResponseToOpenAIResponse(
	geminiResp *genai.GenerateContentResponse,
) openai.ChatCompletionResponse {
	openAIResponse := openai.ChatCompletionResponse{
		Created: time.Now().Unix(),
	}

	for _, cand := range geminiResp.Candidates {
		if cand.Content != nil {
			var choice openai.ChatCompletionChoice
			sb := strings.Builder{}

			choice.Index = int(cand.Index)
			choice.FinishReason = GeminiFinishReasonToOpenAI(cand.FinishReason)

			for _, part := range cand.Content.Parts {
				sb.WriteString(fmt.Sprint(part))
			}

			choice.Message = openai.ChatCompletionMessage{
				Content: sb.String(),
				Role:    "assistant",
			}

			openAIResponse.Choices = append(openAIResponse.Choices, choice)
		}
	}

	return openAIResponse
}

func GeminiFinishReasonToOpenAI(
	finishReason genai.FinishReason,
) openai.FinishReason {
	if openAIReason, ok := googleGeminiFinishReasonToOpenAI[finishReason]; ok {
		return openAIReason
	}
	return openai.FinishReasonNull
}
