package main

import (
	"slices"
	"testing"
)

func TestPocketBaseAuthRateLimitsAreConfigured(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	if !app.Settings().RateLimits.Enabled {
		t.Fatal("RateLimits.Enabled = false, want true")
	}

	labels := make([]string, 0, len(app.Settings().RateLimits.Rules))
	for _, rule := range app.Settings().RateLimits.Rules {
		labels = append(labels, rule.Label)
	}

	for _, want := range []string{
		"*:authRefresh",
		"*:requestVerification",
		"*:requestPasswordReset",
		"*:authWithOAuth2",
	} {
		if !slices.Contains(labels, want) {
			t.Fatalf("RateLimits.Rules missing %q, got %v", want, labels)
		}
	}
}
