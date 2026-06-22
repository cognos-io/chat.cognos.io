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
	// Attachments describe encrypted binary attachments (e.g. generated images)
	// stored as protected files on the message record. The bytes never live in
	// this payload — only the metadata needed to fetch and decrypt them.
	Attachments []MessageAttachment `json:"attachments,omitempty"`
}

// MessageAttachment is the decrypted metadata for one encrypted attachment.
// The ciphertext lives in the message record's protected `attachment` file
// field; this struct carries only what the client needs to decrypt and render
// it. The protected file's name is read from the plaintext record field, so it
// is intentionally not duplicated here.
type MessageAttachment struct {
	// Kind identifies the attachment type, e.g. "generated_image".
	Kind string `json:"kind"`
	// MimeType is the decrypted image's media type, e.g. "image/png".
	MimeType string `json:"mime_type"`
	// SealedKey is base64(SealAnonymous(conversationPublicKey, fileSymKey)) — the
	// per-attachment symmetric key sealed to the conversation public key.
	SealedKey string `json:"sealed_key"`
	// Width and Height are optional display hints (0 when unknown).
	Width  int `json:"width,omitempty"`
	Height int `json:"height,omitempty"`
}
