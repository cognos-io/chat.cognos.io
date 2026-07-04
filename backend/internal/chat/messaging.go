package chat

// MessageRecordData represents the data of a message record.
// Ensure this matches the interface in the frontend.
type MessageRecordData struct {
	Version string `json:"version,omitempty"`
	Content string `json:"content"`
	// Reasoning is provider-returned reasoning text for assistant messages, when
	// the model exposes it. It is encrypted at rest alongside Content and is
	// never written to plaintext columns, logs, analytics, or billing records.
	Reasoning       string `json:"reasoning,omitempty"`
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
	// InputTokens/OutputTokens are the provider's real usage counts for the turn
	// that produced this (assistant) message: InputTokens is the prompt size that
	// was actually sent (system + context + user), OutputTokens the reply size.
	// Stored inside the encrypted blob so context planning uses real numbers
	// rather than a character heuristic (spec §10.1); never logged or billed from
	// here. Zero/absent for messages created before this field existed.
	InputTokens  int64 `json:"input_tokens,omitempty"`
	OutputTokens int64 `json:"output_tokens,omitempty"`
	// Attachments describe encrypted binary attachments (e.g. generated images)
	// stored as protected files on the message record. The bytes never live in
	// this payload — only the metadata needed to fetch and decrypt them.
	Attachments []MessageAttachment `json:"attachments,omitempty"`
	// Citations and CitationAnchors are the web sources a search-grounded answer
	// referenced. They are message content: encrypted at rest alongside Content,
	// and only counts (never URLs/titles) are ever logged. Absent unless web
	// search ran. Keep in sync with the frontend MessageData interface.
	Citations       []MessageCitation       `json:"citations,omitempty"`
	CitationAnchors []MessageCitationAnchor `json:"citation_anchors,omitempty"`
}

// MessageCitation is one web source referenced by a search-grounded answer.
// Title is the displayable name/domain; Snippet is an optional one-line
// description. Mirrors the frontend MessageData citation shape.
type MessageCitation struct {
	URL     string `json:"url"`
	Title   string `json:"title,omitempty"`
	Snippet string `json:"snippet,omitempty"`
}

// MessageCitationAnchor marks the span of the answer a citation annotates.
// Citation is the index into Citations; Start/End are Unicode code-point (rune)
// offsets into Content. Absent when the provider gave no usable offsets.
type MessageCitationAnchor struct {
	Citation int `json:"citation"`
	Start    int `json:"start"`
	End      int `json:"end"`
}

// MessageAttachment is the decrypted metadata for one encrypted attachment.
// The ciphertext lives in the message record's protected `attachment` file
// field; this struct carries only what the client needs to decrypt and render
// it. The protected file's name is read from the plaintext record field, so it
// is intentionally not duplicated here.
type MessageAttachment struct {
	// Kind identifies the attachment type, e.g. "generated_image" or
	// "user_upload".
	Kind string `json:"kind"`
	// MimeType is the decrypted media type, e.g. "image/png". For user uploads
	// it is the detected type, carried as a display hint.
	MimeType string `json:"mime_type,omitempty"`
	// SealedKey is base64(SealAnonymous(conversationPublicKey, fileSymKey)) — the
	// per-attachment symmetric key sealed to the conversation public key. Used by
	// generated images; empty for user uploads, whose keys live in the encrypted
	// user_attachments (library) manifest sealed to the owner's key.
	SealedKey string `json:"sealed_key,omitempty"`
	// AttachmentID references a user_attachments (library) record for user uploads.
	// Empty for generated images, whose bytes live on the message record itself.
	AttachmentID string `json:"attachment_id,omitempty"`
	// Width and Height are optional display hints (0 when unknown).
	Width  int `json:"width,omitempty"`
	Height int `json:"height,omitempty"`
}
