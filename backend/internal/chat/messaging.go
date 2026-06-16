package chat

// MessageRecordData represents the data of a message record.
// Ensure this matches the interface in the frontend.
type MessageRecordData struct {
	Version         string `json:"version,omitempty"`
	Content         string `json:"content"`
	ConversationID  string `json:"conversation_id,omitempty"`
	ParentMessageID string `json:"parent_message_id,omitempty"`
	// CreatedAt is an RFC 3339 timestamp of when the message was created.
	// It lives inside the encrypted blob rather than a plaintext record
	// column so the server persists no message-timing metadata at rest.
	CreatedAt string `json:"created_at,omitempty"`
	// Identifier fields for who has written the message
	// At least one of these fields should be set
	OwnerID   string `json:"owner_id,omitempty"`
	PersonaID string `json:"persona_id,omitempty"`
	ModelID   string `json:"model_id,omitempty"`
}
