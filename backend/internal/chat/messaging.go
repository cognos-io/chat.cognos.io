package chat

type PlainTextMessage struct {
	OwnerID        string `json:"owner_id,omitempty"`
	AgentID        string `json:"agent_id,omitempty"`
	ModelID        string `json:"model_id,omitempty"`
	ConversationID string `json:"conversation_id,omitempty"`
	Content        string `json:"content"`
}

// MessageRecordData represents the data of a message record.
// Ensure this matches the interface in the frontend.
type MessageRecordData struct {
	Version string `json:"version,omitempty"`
	Content string `json:"content"`
}
