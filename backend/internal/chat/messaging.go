package chat

// MessageRecordData represents the data of a message record.
// Ensure this matches the interface in the frontend.
type MessageRecordData struct {
	Version string `json:"version,omitempty"`
	Content string `json:"content"`
	// Identifier fields for who has written the message
	// At least one of these fields should be set
	OwnerID string `json:"owner_id,omitempty"`
	AgentID string `json:"agent_id,omitempty"`
	ModelID string `json:"model_id,omitempty"`
}
