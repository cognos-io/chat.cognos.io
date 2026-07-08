package retention

import (
	"testing"
	"time"
)

func TestEffectiveRetentionDays(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		conversation   int
		accountDefault int
		want           int
	}{
		{"inherit + account never → never", ConversationInherit, AccountNever, 0},
		{"inherit + account 7d → 7d", ConversationInherit, 7, 7},
		{"inherit + account 30d → 30d", ConversationInherit, 30, 30},
		{"conversation never overrides account 7d", ConversationNever, 7, 0},
		{"conversation never + account never", ConversationNever, AccountNever, 0},
		{"conversation 7d overrides account never", 7, AccountNever, 7},
		{"conversation 7d overrides account 30d", 7, 30, 7},
		{"conversation 30d overrides account 7d", 30, 7, 30},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := EffectiveRetentionDays(tt.conversation, tt.accountDefault); got != tt.want {
				t.Fatalf("EffectiveRetentionDays(%d, %d) = %d, want %d",
					tt.conversation, tt.accountDefault, got, tt.want)
			}
		})
	}
}

func TestElapsed(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name         string
		lastActivity time.Time
		days         int
		want         bool
	}{
		{"never (0 days) is never elapsed", now.Add(-365 * 24 * time.Hour), 0, false},
		{"negative days never elapsed", now.Add(-365 * 24 * time.Hour), -1, false},
		{"zero last-activity never elapsed", time.Time{}, 7, false},
		{"7d window, active 8d ago → elapsed", now.Add(-8 * 24 * time.Hour), 7, true},
		{"7d window, active 6d ago → kept", now.Add(-6 * 24 * time.Hour), 7, false},
		{"7d window, exactly 7d ago → kept (boundary)", now.Add(-7 * 24 * time.Hour), 7, false},
		{"7d window, just past 7d → elapsed", now.Add(-7*24*time.Hour - time.Minute), 7, true},
		{"30d window, active 31d ago → elapsed", now.Add(-31 * 24 * time.Hour), 30, true},
		{"future last-activity → kept", now.Add(24 * time.Hour), 7, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := Elapsed(tt.lastActivity, tt.days, now); got != tt.want {
				t.Fatalf("Elapsed(%v, %d, %v) = %v, want %v",
					tt.lastActivity, tt.days, now, got, tt.want)
			}
		})
	}
}
