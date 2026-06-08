package aiagent

import (
	"errors"
	"log/slog"
	"testing"
)

func TestInMemoryAIAgentRepoReturnsHardcodedPrompts(t *testing.T) {
	t.Parallel()

	repo := NewInMemoryAIAgentRepo(slog.Default())

	prompt, err := repo.LookupPrompt("cognos:simple-assistant")
	if err != nil {
		t.Fatalf("LookupPrompt(simple-assistant) error = %v", err)
	}
	if prompt.SystemMessage != SimpleAssistant.SystemMessage {
		t.Errorf("LookupPrompt(simple-assistant) returned a different prompt than SimpleAssistant")
	}

	titlePrompt, err := repo.LookupPrompt("cognos:generate-conversation-agent")
	if err != nil {
		t.Fatalf("LookupPrompt(generate-conversation-agent) error = %v", err)
	}
	if titlePrompt.SystemMessage != GenerateConversationAgent.SystemMessage {
		t.Errorf("LookupPrompt(generate-conversation-agent) returned a different prompt than GenerateConversationAgent")
	}
}

func TestInMemoryAIAgentRepoReturnsErrAgentNotFoundForUnknownIDs(t *testing.T) {
	t.Parallel()

	repo := NewInMemoryAIAgentRepo(slog.Default())

	for _, id := range []string{
		"",
		"unknown",
		"cognos:nonexistent",
		"cognos:simple-assistant ",  // trailing space — exact-match only
		" cognos:simple-assistant",  // leading space
		"cognos:Simple-Assistant",   // case-sensitive
		"openai:simple-assistant",   // wrong namespace
	} {
		if _, err := repo.LookupPrompt(id); !errors.Is(err, ErrAgentNotFound) {
			t.Errorf("LookupPrompt(%q) error = %v, want ErrAgentNotFound", id, err)
		}
	}
}

func TestBuildMessages_EmptyReturnsInputUnchanged(t *testing.T) {
	t.Parallel()

	out := BuildMessages(SimpleAssistant, nil)
	if out != nil {
		t.Fatalf("BuildMessages(empty) = %#v, want nil", out)
	}

	empty := []Message{}
	out = BuildMessages(SimpleAssistant, empty)
	if len(out) != 0 {
		t.Fatalf("BuildMessages(empty slice) len = %d, want 0", len(out))
	}
}

func TestBuildMessages_InjectsSystemMessageFromPrompt(t *testing.T) {
	t.Parallel()

	user := Message{Role: "user", Content: "hi"}
	out := BuildMessages(SimpleAssistant, []Message{user})

	if len(out) != 1+len(SimpleAssistant.Examples)+1 {
		t.Fatalf("BuildMessages got %d messages, want %d", len(out), 1+len(SimpleAssistant.Examples)+1)
	}
	if out[0].Role != "system" || out[0].Content != SimpleAssistant.SystemMessage {
		t.Errorf("first message = %+v, want system message from prompt", out[0])
	}
	last := out[len(out)-1]
	if last != user {
		t.Errorf("last message = %+v, want %+v", last, user)
	}
}

func TestBuildMessages_RespectsCallerProvidedSystemMessage(t *testing.T) {
	t.Parallel()

	custom := Message{Role: "system", Content: "custom prompt"}
	user := Message{Role: "user", Content: "hi"}
	stray := Message{Role: "system", Content: "stray prompt"}

	out := BuildMessages(SimpleAssistant, []Message{custom, user, stray})

	if out[0] != custom {
		t.Errorf("first message = %+v, want caller-provided system message %+v", out[0], custom)
	}
	for _, msg := range out[1:] {
		if msg.Role == "system" {
			t.Errorf("unexpected system message in body: %+v", msg)
		}
	}
}

func TestBuildMessages_StripsDuplicateSystemMessages(t *testing.T) {
	t.Parallel()

	user := Message{Role: "user", Content: "hi"}
	dup := Message{Role: "system", Content: "should be removed"}

	out := BuildMessages(SimpleAssistant, []Message{user, dup, dup})

	systemCount := 0
	for _, msg := range out {
		if msg.Role == "system" {
			systemCount++
		}
	}
	if systemCount != 1 {
		t.Errorf("system messages in output = %d, want 1", systemCount)
	}
}

func TestBuildMessages_InsertsAgentExamplesBetweenSystemAndUser(t *testing.T) {
	t.Parallel()

	user := Message{Role: "user", Content: "hi"}
	out := BuildMessages(GenerateConversationAgent, []Message{user})

	if len(out) != 1+len(GenerateConversationAgent.Examples)+1 {
		t.Fatalf("len = %d, want %d", len(out), 1+len(GenerateConversationAgent.Examples)+1)
	}
	for i, example := range GenerateConversationAgent.Examples {
		if out[1+i] != example {
			t.Errorf("examples[%d] = %+v, want %+v", i, out[1+i], example)
		}
	}
	if out[len(out)-1] != user {
		t.Errorf("trailing user message = %+v, want %+v", out[len(out)-1], user)
	}
}
