package openai_test

import (
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/pkg/aiagent"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/compat/openai"
	oai "github.com/sashabaranov/go-openai"
)

var (
	customAssistantSystemMessage = oai.ChatCompletionMessage{
		Role:    "system",
		Content: "I'm a simple assistant",
	}
	simpleAssistantSystemMessage = oai.ChatCompletionMessage{
		Role:    "system",
		Content: aiagent.SimpleAssistant.SystemMessage,
	}
	userMessage = oai.ChatCompletionMessage{
		Role:    "user",
		Content: "Hello",
	}
	assistantMessage = oai.ChatCompletionMessage{
		Role:    "assistant",
		Content: "Hi",
	}
)

func TestAddSystemMessage(t *testing.T) {
	tt := []struct {
		Name string

		InputMessages    []oai.ChatCompletionMessage
		InputAgent       aiagent.Prompt
		ExpectedMessages []oai.ChatCompletionMessage
	}{
		{
			Name:             "Add system message to empty messages",
			InputMessages:    []oai.ChatCompletionMessage{},
			InputAgent:       aiagent.SimpleAssistant,
			ExpectedMessages: []oai.ChatCompletionMessage{},
		},
		{
			Name: "Add system message to non-empty messages",
			InputMessages: []oai.ChatCompletionMessage{
				userMessage,
				assistantMessage,
			},
			InputAgent: aiagent.SimpleAssistant,
			ExpectedMessages: []oai.ChatCompletionMessage{
				simpleAssistantSystemMessage,
				userMessage,
				assistantMessage,
			},
		},
		{
			Name: "Add system message to non-empty messages with system message already present",
			InputMessages: []oai.ChatCompletionMessage{
				customAssistantSystemMessage,
				userMessage,
				assistantMessage,
				simpleAssistantSystemMessage,
				simpleAssistantSystemMessage,
			},
			InputAgent: aiagent.SimpleAssistant,
			ExpectedMessages: []oai.ChatCompletionMessage{
				customAssistantSystemMessage,
				userMessage,
				assistantMessage,
			},
		},
		{
			Name: "Add system message to non-empty messages with system message",
			InputMessages: []oai.ChatCompletionMessage{
				userMessage,
				simpleAssistantSystemMessage,
				assistantMessage,
				simpleAssistantSystemMessage,
				simpleAssistantSystemMessage,
			},
			InputAgent: aiagent.SimpleAssistant,
			ExpectedMessages: []oai.ChatCompletionMessage{
				simpleAssistantSystemMessage,
				userMessage,
				assistantMessage,
			},
		},
	}
	for _, tc := range tt {
		t.Run(tc.Name, func(t *testing.T) {
			processedMessages := openai.AddSystemMessage(
				tc.InputMessages,
				tc.InputAgent,
			)
			if len(processedMessages) != len(tc.ExpectedMessages) {
				t.Errorf(
					"Expected %d messages, got %d",
					len(tc.ExpectedMessages),
					len(processedMessages),
				)
			}
			for i, expectedMessage := range tc.ExpectedMessages {
				if processedMessages[i].Role != expectedMessage.Role {
					t.Errorf(
						"Expected message role %s, got %s",
						expectedMessage.Role,
						processedMessages[i].Role,
					)
				}
				if processedMessages[i].Content != expectedMessage.Content {
					t.Errorf(
						"Expected message content %s, got %s",
						expectedMessage.Content,
						processedMessages[i].Content,
					)
				}
			}
		})
	}
}
