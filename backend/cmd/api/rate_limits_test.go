package main

import (
	"slices"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/hooks"
)

func TestPocketBaseAuthRateLimitsAreConfigured(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	hooks.ApplyRateLimits(app)

	if !app.Settings().RateLimits.Enabled {
		t.Fatal("RateLimits.Enabled = false, want true")
	}

	labels := make([]string, 0, len(app.Settings().RateLimits.Rules))
	for _, rule := range app.Settings().RateLimits.Rules {
		labels = append(labels, rule.Label)
	}

	for _, want := range []string{
		"*:authRefresh",
		"*:authWithPassword",
		"users:create",
		"*:requestVerification",
		"*:requestPasswordReset",
		"*:confirmPasswordReset",
		"*:requestEmailChange",
		"*:confirmEmailChange",
	} {
		if !slices.Contains(labels, want) {
			t.Fatalf("RateLimits.Rules missing %q, got %v", want, labels)
		}
	}

	// Password sign-in and registration must stay tightly capped. Assert exact
	// budgets so a Duration shrink or MaxRequests creep cannot pass silently.
	for _, rule := range app.Settings().RateLimits.Rules {
		switch rule.Label {
		case "*:authWithPassword":
			if rule.MaxRequests != 10 || rule.Duration != 300 {
				t.Fatalf("authWithPassword = %d/%ds, want 10/300s", rule.MaxRequests, rule.Duration)
			}
		case "users:create":
			if rule.MaxRequests != 5 || rule.Duration != 300 {
				t.Fatalf("users:create = %d/%ds, want 5/300s", rule.MaxRequests, rule.Duration)
			}
		}
	}
}
