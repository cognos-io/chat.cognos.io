package proxy

import (
	"fmt"
	"log/slog"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/labstack/echo/v5"
	"github.com/sashabaranov/go-openai"
)

// https://deepinfra.com/models/text-generation
var deepInfraModelMapping = map[string]string{
	"openchat-3.6-8b":              "openchat/openchat-3.6-8b",
	"wizardlm-2-8x22b":             "microsoft/WizardLM-2-8x22B",                     // https://deepinfra.com/microsoft/WizardLM-2-8x22B
	"gemma-1.1-7b-it":              "google/gemma-1.1-7b-it",                         // https://deepinfra.com/google/gemma-1.1-7b-it
	"dolphin-2.6-mixtral-8x7b":     "cognitivecomputations/dolphin-2.6-mixtral-8x7b", // https://deepinfra.com/cognitivecomputations/dolphin-2.6-mixtral-8x7b
	"chronos-hermes-13b-v2":        "Austism/chronos-hermes-13b-v2",                  // https://deepinfra.com/Austism/chronos-hermes-13b-v2
	"mythomax-l2-13b-turbo":        "Gryphe/MythoMax-L2-13b-turbo",                   // https://deepinfra.com/Gryphe/MythoMax-L2-13b-turbo
	"zephyr-orpo-141b-A35b-v0.1":   "HuggingFaceH4/zephyr-orpo-141b-A35b-v0.1",       // https://deepinfra.com/HuggingFaceH4/zephyr-orpo-141b-A35b-v0.1
	"phind-codellama-34b-v2":       "Phind/Phind-CodeLlama-34B-v2",                   // https://deepinfra.com/Phind/Phind-CodeLlama-34B-v2
	"starcoder2-15b-instruct-v0.1": "bigcode/starcoder2-15b-instruct-v0.1",           // https://deepinfra.com/bigcode/starcoder2-15b-instruct-v0.1
	"codegemma-7b-it":              "google/codegemma-7b-it",                         // https://deepinfra.com/google/codegemma-7b-it
	"llama-3-8b-instruct":          "meta-llama/Meta-Llama-3-8B-Instruct",            // https://deepinfra.com/meta-llama/Meta-Llama-3-8B-Instruct
	"lzlv_70b_fp16_hf":             "lizpreciatior/lzlv_70b_fp16_hf",                 // https://deepinfra.com/lizpreciatior/lzlv_70b_fp16_hf
}

var _ Upstream = (*DeepInfra)(nil)

func NewDeepInfraOpenAIClient(config *config.APIConfig) *openai.Client {
	openAIConfig := openai.DefaultConfig(config.DeepInfraAPIKey)
	openAIConfig.BaseURL = config.DeepInfraAPIURL
	return openai.NewClientWithConfig(openAIConfig)
}

type DeepInfra struct {
	client *openai.Client
	logger *slog.Logger
}

func (d *DeepInfra) LookupModel(
	internalModel string,
) (string, error) {
	return DeepInfraModelMapper(internalModel)
}

func (d *DeepInfra) ChatCompletion(
	c echo.Context,
	req openai.ChatCompletionRequest,
) (response openai.ChatCompletionResponse, plainTextResponseMessage string, err error) {
	if req.Stream {
		return StreamOpenAIResponse(c, req, d.logger, d.client)
	}
	return ForwardOpenAIResponse(c, req, d.logger, d.client)
}

func NewDeepInfra(client *openai.Client, logger *slog.Logger) *DeepInfra {
	return &DeepInfra{
		client: client,
		logger: logger,
	}
}

func DeepInfraModelMapper(model string) (string, error) {
	if mappedModel, ok := deepInfraModelMapping[model]; ok {
		return mappedModel, nil
	}
	return "", fmt.Errorf("invalid model name: %s", model)
}
