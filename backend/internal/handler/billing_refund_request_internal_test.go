package handler

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// The refund reason is free text under user control. Logging must cap it so a
// caller can't stuff megabytes (or log-injection payloads padded to arbitrary
// length) into the operator log stream.
func TestTruncateReasonForLog(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty stays empty", input: "", want: ""},
		{name: "short reason untouched", input: "too expensive", want: "too expensive"},
		{
			name:  "exactly at the cap untouched",
			input: strings.Repeat("a", maxLoggedReasonChars),
			want:  strings.Repeat("a", maxLoggedReasonChars),
		},
		{
			name:  "over the cap truncated with ellipsis",
			input: strings.Repeat("a", maxLoggedReasonChars+1),
			want:  strings.Repeat("a", maxLoggedReasonChars) + "…",
		},
		{
			name:  "multi-byte runes are not split",
			input: strings.Repeat("ü", maxLoggedReasonChars+50),
			want:  strings.Repeat("ü", maxLoggedReasonChars) + "…",
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := truncateReasonForLog(tc.input)
			if got != tc.want {
				t.Errorf("truncateReasonForLog() length = %d, want %d", len(got), len(tc.want))
			}
			if !utf8.ValidString(got) {
				t.Error("truncateReasonForLog() produced invalid UTF-8")
			}
			if utf8.RuneCountInString(got) > maxLoggedReasonChars+1 {
				t.Errorf("truncateReasonForLog() rune count = %d, want <= %d", utf8.RuneCountInString(got), maxLoggedReasonChars+1)
			}
		})
	}
}
