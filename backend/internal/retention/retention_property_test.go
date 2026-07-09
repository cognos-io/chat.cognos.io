package retention

import (
	"testing"
	"time"

	"pgregory.net/rapid"
)

// Property: the retention resolver always prefers the explicit conversation
// setting when present, falls back to the account default on inherit, and
// never returns a negative number.
func TestEffectiveRetentionDaysProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		conversationDays := rapid.IntRange(-5, 40).Draw(t, "conversationDays")
		accountDefaultDays := rapid.IntRange(-5, 40).Draw(t, "accountDefaultDays")

		got := EffectiveRetentionDays(conversationDays, accountDefaultDays)
		if got < 0 {
			t.Fatalf("EffectiveRetentionDays(%d, %d) = %d, want >= 0", conversationDays, accountDefaultDays, got)
		}
		switch {
		case conversationDays > 0:
			if got != conversationDays {
				t.Fatalf("EffectiveRetentionDays(%d, %d) = %d, want conversation override", conversationDays, accountDefaultDays, got)
			}
		case conversationDays < 0:
			if got != 0 {
				t.Fatalf("EffectiveRetentionDays(%d, %d) = %d, want never-delete sentinel", conversationDays, accountDefaultDays, got)
			}
		case accountDefaultDays > 0:
			if got != accountDefaultDays {
				t.Fatalf("EffectiveRetentionDays(%d, %d) = %d, want account default", conversationDays, accountDefaultDays, got)
			}
		case accountDefaultDays <= 0:
			if got != 0 {
				t.Fatalf("EffectiveRetentionDays(%d, %d) = %d, want 0", conversationDays, accountDefaultDays, got)
			}
		}
	})
}

// Property: Elapsed changes strictly after the cutoff and is monotone in the
// current time. This pins the exact boundary behaviour used by the deletion
// job.
func TestElapsedProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		days := rapid.IntRange(1, MaxRetentionDays).Draw(t, "days")
		lastActivity := time.Unix(1_700_000_000, 0).UTC().Add(-time.Duration(rapid.IntRange(0, 30).Draw(t, "ageDays")) * 24 * time.Hour)

		cutoff := lastActivity.Add(time.Duration(days) * 24 * time.Hour)
		if Elapsed(lastActivity, days, cutoff) {
			t.Fatalf("Elapsed(%v, %d, cutoff) = true, want false at the boundary", lastActivity, days)
		}
		if !Elapsed(lastActivity, days, cutoff.Add(time.Nanosecond)) {
			t.Fatalf("Elapsed(%v, %d, cutoff+1ns) = false, want true just after the boundary", lastActivity, days)
		}

		earlier := cutoff.Add(-time.Duration(rapid.IntRange(1, 24*60).Draw(t, "earlierMinutes")) * time.Minute)
		later := cutoff.Add(time.Duration(rapid.IntRange(1, 24*60).Draw(t, "laterMinutes")) * time.Minute)
		if Elapsed(lastActivity, days, earlier) && !Elapsed(lastActivity, days, later) {
			t.Fatalf("Elapsed is not monotone: true at %v but false at %v", earlier, later)
		}
	})
}
