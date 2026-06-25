// Package compaction builds, parses, encrypts and persists conversation
// compactions: encrypted summaries of older prefixes of a conversation's active
// branch, so long chats keep fitting model context windows.
//
// See docs/specs/client-side-compaction.md. The collection stores only the
// conversation relation and a ciphertext `data` blob; every detail below lives
// inside that ciphertext and is never written to a plaintext column or a log.
package compaction

const (
	// PayloadVersion is the schema version of the encrypted payload.
	PayloadVersion = "1"
	// PayloadKind tags the payload so a client can distinguish it from other
	// sealed blobs decrypted with the same conversation key.
	PayloadKind = "conversation_compaction"
	// PromptVersion versions the backend-owned compaction prompt so older
	// compactions remain interpretable after prompt changes.
	PromptVersion = "compaction_v1"
)

// OutputMode records how the model produced this compaction, so the parser and
// future tooling know what to expect (spec §8.3).
type OutputMode string

const (
	// OutputModeStructured is native JSON-schema / forced-tool output. Reserved
	// for when structured output is plumbed through the gateway; not used in V1.
	OutputModeStructured OutputMode = "structured"
	// OutputModeDelimitedText is JSON emitted between <compaction> delimiters and
	// recovered with a tolerant parser. The provider-agnostic V1 default.
	OutputModeDelimitedText OutputMode = "delimited_text"
)

// GlossaryEntry preserves a redaction placeholder or an important exact name so
// it survives summarisation verbatim (spec §8.2).
type GlossaryEntry struct {
	Term string `json:"term"`
	Note string `json:"note"`
}

// DurableMemory is the slowly-changing part of a compaction. On a fold it is
// merged with the prior memory rather than regenerated wholesale, which keeps it
// stable enough to act as a cache-friendly prefix (spec §8.2, §9.3).
type DurableMemory struct {
	Facts       []string        `json:"facts"`
	Decisions   []string        `json:"decisions"`
	OpenThreads []string        `json:"open_threads"`
	Glossary    []GlossaryEntry `json:"glossary"`
}

// Citation maps a provider-safe alias (e.g. "M12") to a real message ID. The
// alias is all the provider ever sees; the message ID is filled in server-side
// from the alias map and never leaves the encrypted payload (spec §8.4).
type Citation struct {
	Label     string `json:"label"`
	MessageID string `json:"message_id"`
}

// Payload is the full decrypted compaction record. The model contributes only
// DurableMemory, RollingNarrative and citation labels; the backend fills in
// everything else (spec §6.2).
type Payload struct {
	Version string `json:"version"`
	Kind    string `json:"kind"`

	ConversationID string `json:"conversation_id"`
	// AnchorMessageID is the newest message represented by this compaction.
	AnchorMessageID string `json:"anchor_message_id"`
	// CoveredMessageIDs is every message now represented, including those folded
	// in from a parent compaction.
	CoveredMessageIDs []string `json:"covered_message_ids"`

	// ParentCompactionID is the compaction whose summary was folded in. Empty
	// string means this is a level-0 (raw-only) compaction (spec §8.1).
	ParentCompactionID string `json:"parent_compaction_id"`
	// CompactionLevel is 0 for a leaf compaction and n for one folded n times.
	CompactionLevel int `json:"compaction_level"`

	DurableMemory    DurableMemory `json:"durable_memory"`
	RollingNarrative string        `json:"rolling_narrative"`

	Citations []Citation `json:"citations"`

	SourceTokenEstimate  int `json:"source_token_estimate"`
	SummaryTokenEstimate int `json:"summary_token_estimate"`

	ModelID       string     `json:"model_id"`
	PromptVersion string     `json:"prompt_version"`
	OutputMode    OutputMode `json:"output_mode"`
	CreatedAt     string     `json:"created_at"`
}
