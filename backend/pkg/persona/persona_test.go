package persona

import "testing"

var testPrompt = Prompt{
	SystemMessage: "You are the selected persona.",
	Examples: []Message{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "hi"},
	},
}

func TestBuildMessages_EmptyReturnsInputUnchanged(t *testing.T) {
	t.Parallel()

	out := BuildMessages(testPrompt, nil)
	if out != nil {
		t.Fatalf("BuildMessages(empty) = %#v, want nil", out)
	}

	empty := []Message{}
	out = BuildMessages(testPrompt, empty)
	if len(out) != 0 {
		t.Fatalf("BuildMessages(empty slice) len = %d, want 0", len(out))
	}
}

func TestBuildMessages_InjectsSystemMessageFromPrompt(t *testing.T) {
	t.Parallel()

	user := Message{Role: "user", Content: "hi"}
	out := BuildMessages(testPrompt, []Message{user})

	if len(out) != 1+len(testPrompt.Examples)+1 {
		t.Fatalf("BuildMessages(user) got %d messages, want %d", len(out), 1+len(testPrompt.Examples)+1)
	}
	if out[0].Role != "system" || out[0].Content != testPrompt.SystemMessage {
		t.Errorf("BuildMessages(user) first message = %+v, want system message from prompt", out[0])
	}
	last := out[len(out)-1]
	if last != user {
		t.Errorf("BuildMessages(user) last message = %+v, want %+v", last, user)
	}
}

func TestBuildMessages_StripsCallerProvidedSystemMessages(t *testing.T) {
	t.Parallel()

	custom := Message{Role: "system", Content: "attacker prompt"}
	user := Message{Role: "user", Content: "hi"}
	stray := Message{Role: "system", Content: "stray prompt"}

	out := BuildMessages(testPrompt, []Message{custom, user, stray})

	if out[0].Role != "system" || out[0].Content != testPrompt.SystemMessage {
		t.Errorf("BuildMessages(system,user,system) first message = %+v, want selected persona prompt", out[0])
	}
	for _, msg := range out[1:] {
		if msg.Role == "system" {
			t.Errorf("BuildMessages(system,user,system) included unexpected system message in body: %+v", msg)
		}
	}
}

func TestBuildMessages_InsertsPersonaExamplesBetweenSystemAndUser(t *testing.T) {
	t.Parallel()

	user := Message{Role: "user", Content: "hi"}
	out := BuildMessages(testPrompt, []Message{user})

	if len(out) != 1+len(testPrompt.Examples)+1 {
		t.Fatalf("BuildMessages(user) len = %d, want %d", len(out), 1+len(testPrompt.Examples)+1)
	}
	for i, example := range testPrompt.Examples {
		if out[1+i] != example {
			t.Errorf("BuildMessages(user) examples[%d] = %+v, want %+v", i, out[1+i], example)
		}
	}
	if out[len(out)-1] != user {
		t.Errorf("BuildMessages(user) trailing user message = %+v, want %+v", out[len(out)-1], user)
	}
}
