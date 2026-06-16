package persona

// Message is the provider-neutral chat message shape consumed by Cognos
// internals. Adapters convert it to whatever wire format their provider
// requires.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Name    string `json:"name,omitempty"`
}

type Prompt struct {
	SystemMessage string    `json:"system_message"`
	Examples      []Message `json:"examples"`
	NumTokens     int       `json:"num_tokens"`
}

// BuildMessages prepends a system message derived from prompt to messages.
// Caller-supplied system messages are stripped so the selected persona remains
// the only system prompt sent to the provider.
//
// Persona example exchanges are inserted between the system message and the
// caller-supplied messages.
//
// If messages is empty, the slice is returned unchanged so the handler can
// fast-fail on missing input before constructing a prompt.
func BuildMessages(prompt Prompt, messages []Message) []Message {
	if len(messages) == 0 {
		return messages
	}

	filtered := make([]Message, 0, len(messages))
	for _, msg := range messages {
		if msg.Role != "system" {
			filtered = append(filtered, msg)
		}
	}

	out := make([]Message, 0, 1+len(prompt.Examples)+len(filtered))
	out = append(out, Message{Role: "system", Content: prompt.SystemMessage})
	out = append(out, prompt.Examples...)
	out = append(out, filtered...)
	return out
}
