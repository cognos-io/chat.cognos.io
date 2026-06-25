package compaction

// AliasMap builds the alias→message-ID lookup used to resolve citations. The
// map never leaves the server: aliases go to the provider, message IDs go into
// the encrypted payload.
func AliasMap(messages []InputMessage) map[string]string {
	m := make(map[string]string, len(messages))
	for _, msg := range messages {
		if msg.Alias != "" && msg.MessageID != "" {
			m[msg.Alias] = msg.MessageID
		}
	}
	return m
}

// CoveredMessageIDs returns every message ID now represented by a compaction:
// the parent's covered set (on a fold) followed by this call's messages, with
// duplicates removed and order preserved.
func CoveredMessageIDs(prior *PriorSummary, messages []InputMessage) []string {
	seen := make(map[string]struct{})
	covered := make([]string, 0, len(messages))
	add := func(id string) {
		if id == "" {
			return
		}
		if _, dup := seen[id]; dup {
			return
		}
		seen[id] = struct{}{}
		covered = append(covered, id)
	}
	if prior != nil {
		for _, id := range prior.CoveredMessageIDs {
			add(id)
		}
	}
	for _, msg := range messages {
		add(msg.MessageID)
	}
	return covered
}

// AssembleInput carries everything the backend needs to turn a ParseResult into
// a complete, persistable Payload.
type AssembleInput struct {
	ConversationID       string
	AnchorMessageID      string
	Prior                *PriorSummary
	ParentCompactionID   string
	Messages             []InputMessage
	SourceTokenEstimate  int
	ModelID              string
	OutputMode           OutputMode
	CreatedAt            string
	SummaryTokenEstimate int
}

// Assemble combines the model's parsed output with server-known metadata into
// the final Payload. The CompactionLevel is derived from the prior summary's
// presence — level 0 for a leaf, parent level + 1 is set by the caller when it
// knows the parent's level.
func Assemble(in AssembleInput, parsed ParseResult, compactionLevel int) Payload {
	covered := CoveredMessageIDs(in.Prior, in.Messages)
	citations := parsed.Citations
	if citations == nil {
		citations = []Citation{}
	}
	return Payload{
		Version:              PayloadVersion,
		Kind:                 PayloadKind,
		ConversationID:       in.ConversationID,
		AnchorMessageID:      in.AnchorMessageID,
		CoveredMessageIDs:    covered,
		ParentCompactionID:   in.ParentCompactionID,
		CompactionLevel:      compactionLevel,
		DurableMemory:        parsed.DurableMemory,
		RollingNarrative:     parsed.RollingNarrative,
		Citations:            citations,
		SourceTokenEstimate:  in.SourceTokenEstimate,
		SummaryTokenEstimate: in.SummaryTokenEstimate,
		ModelID:              in.ModelID,
		PromptVersion:        PromptVersion,
		OutputMode:           in.OutputMode,
		CreatedAt:            in.CreatedAt,
	}
}
