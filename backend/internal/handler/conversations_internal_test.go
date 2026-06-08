package handler

import "testing"

func TestParsePositiveIntOrDefaultFallsBackForBadInputs(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		raw  string
		want int
	}{
		{name: "empty", raw: "", want: 25},
		{name: "non-numeric", raw: "abc", want: 25},
		{name: "negative", raw: "-1", want: 25},
		{name: "zero", raw: "0", want: 25},
		{name: "fractional", raw: "1.5", want: 25},
		{name: "with whitespace", raw: " 1 ", want: 25},
		{name: "trailing characters", raw: "10x", want: 25},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := parsePositiveIntOrDefault(tc.raw, 25); got != tc.want {
				t.Errorf("parsePositiveIntOrDefault(%q, 25) = %d, want %d", tc.raw, got, tc.want)
			}
		})
	}
}

func TestParsePositiveIntOrDefaultPassesThroughValidInput(t *testing.T) {
	t.Parallel()

	if got := parsePositiveIntOrDefault("3", 25); got != 3 {
		t.Errorf("parsePositiveIntOrDefault(\"3\", 25) = %d, want 3", got)
	}
	if got := parsePositiveIntOrDefault("100", 25); got != 100 {
		t.Errorf("parsePositiveIntOrDefault(\"100\", 25) = %d, want 100", got)
	}
}

func TestIsValidExpiryDurationAcceptsCanonicalValues(t *testing.T) {
	t.Parallel()

	// Empty means "no expiry"; the other values are the documented
	// product choices for ephemeral conversations.
	for _, value := range []string{"", "24h", "168h", "2160h", "4320h"} {
		t.Run(value, func(t *testing.T) {
			t.Parallel()
			if !isValidExpiryDuration(value) {
				t.Errorf("isValidExpiryDuration(%q) = false, want true", value)
			}
		})
	}
}

func TestIsValidExpiryDurationRejectsEverythingElse(t *testing.T) {
	t.Parallel()

	// Includes superficially valid duration strings (which time.ParseDuration
	// would accept) — the handler is intentionally a strict allow-list to
	// stop arbitrary durations from being persisted on the record.
	for _, value := range []string{
		"1h",
		"48h",
		"24H",         // case-sensitive
		" 24h",        // whitespace
		"24h ",        // trailing whitespace
		"24h\n",       // newline injection attempt
		"24h;DROP",    // sql-injection-shaped payload
		"720h",        // 30d -- intentionally unsupported
		"-24h",        // negative duration
		"forever",     // word
		"javascript:", // protocol-style payload
	} {
		t.Run(value, func(t *testing.T) {
			t.Parallel()
			if isValidExpiryDuration(value) {
				t.Errorf("isValidExpiryDuration(%q) = true, want false", value)
			}
		})
	}
}
