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
}
