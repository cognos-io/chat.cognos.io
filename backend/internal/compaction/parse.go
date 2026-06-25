package compaction

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
)

// ErrNoCompactionBlock is returned when no parsable JSON object can be recovered
// from the model output. The handler may retry once before giving up; compaction
// is best-effort (spec §8.3).
var ErrNoCompactionBlock = errors.New("compaction: no parsable JSON object in model output")

var (
	compactionTagRe = regexp.MustCompile(`(?s)<compaction>(.*?)</compaction>`)
	aliasRefRe      = regexp.MustCompile(`\[(M\d+)\]`)
)

// ParseResult is the parsed, alias-resolved model output.
type ParseResult struct {
	DurableMemory    DurableMemory
	RollingNarrative string
	Citations        []Citation
}

// Parse recovers the compaction JSON from raw model output and resolves citation
// aliases to real message IDs. It is deliberately tolerant: it accepts the
// <compaction>-delimited form first, then falls back to the outermost JSON
// object in the text. Citations referencing an alias that is not in the input
// set are dropped (not fatal) — they would be dead links, and failing the whole
// compaction over a stray label is worse than a missing citation (spec §8.4).
func Parse(raw string, aliasToMessageID map[string]string) (ParseResult, error) {
	jsonText, ok := extractJSON(raw)
	if !ok {
		return ParseResult{}, ErrNoCompactionBlock
	}

	var out modelOutput
	if err := json.Unmarshal([]byte(jsonText), &out); err != nil {
		return ParseResult{}, ErrNoCompactionBlock
	}

	result := ParseResult{
		DurableMemory:    normaliseMemory(out.DurableMemory),
		RollingNarrative: strings.TrimSpace(out.RollingNarrative),
	}

	// Collect candidate aliases: those the model listed, plus any [Mx] it
	// referenced in the narrative or facts (a model may cite inline but forget
	// the citations array).
	candidates := make([]string, 0, len(out.Citations))
	candidates = append(candidates, out.Citations...)
	candidates = append(candidates, referencedAliases(result)...)

	seen := make(map[string]struct{})
	for _, label := range candidates {
		label = strings.TrimSpace(strings.Trim(label, "[]"))
		if label == "" {
			continue
		}
		if _, dup := seen[label]; dup {
			continue
		}
		messageID, known := aliasToMessageID[label]
		if !known {
			continue // drop dead links rather than fail (spec §8.4)
		}
		seen[label] = struct{}{}
		result.Citations = append(result.Citations, Citation{Label: label, MessageID: messageID})
	}

	return result, nil
}

// extractJSON returns the JSON body to parse: the <compaction>…</compaction>
// content if present, otherwise the outermost {…} span in the text.
func extractJSON(raw string) (string, bool) {
	if m := compactionTagRe.FindStringSubmatch(raw); m != nil {
		if body := strings.TrimSpace(m[1]); body != "" {
			return body, true
		}
	}
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start >= 0 && end > start {
		return raw[start : end+1], true
	}
	return "", false
}

// referencedAliases scans the rolling narrative and durable-memory strings for
// inline [Mx] references.
func referencedAliases(r ParseResult) []string {
	var refs []string
	scan := func(s string) {
		for _, m := range aliasRefRe.FindAllStringSubmatch(s, -1) {
			refs = append(refs, m[1])
		}
	}
	scan(r.RollingNarrative)
	for _, f := range r.DurableMemory.Facts {
		scan(f)
	}
	for _, d := range r.DurableMemory.Decisions {
		scan(d)
	}
	for _, t := range r.DurableMemory.OpenThreads {
		scan(t)
	}
	return refs
}

// normaliseMemory guarantees non-nil slices so the encrypted payload always has
// the documented shape (empty arrays rather than null).
func normaliseMemory(m DurableMemory) DurableMemory {
	if m.Facts == nil {
		m.Facts = []string{}
	}
	if m.Decisions == nil {
		m.Decisions = []string{}
	}
	if m.OpenThreads == nil {
		m.OpenThreads = []string{}
	}
	if m.Glossary == nil {
		m.Glossary = []GlossaryEntry{}
	}
	return m
}
