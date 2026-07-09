package handler

import (
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
	"pgregory.net/rapid"
)

// Property: reasoningOutputPlan never violates the provider's max_tokens >
// thinking.budget_tokens invariant, and it respects the model ceiling when one
// is present. The example tests pin the exact cases; this pins the contract
// across a broader set of requested-output and model-cap combinations.
func TestReasoningOutputPlanProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		requested := rapid.IntRange(-10_000, 100_000).Draw(t, "requested")
		modelMax := rapid.IntRange(0, 100_000).Draw(t, "modelMax")
		plan := rapid.SampledFrom([]billing.PlanType{
			billing.PlanTypeTrial,
			billing.PlanTypePayG,
			billing.PlanTypeUnlimited,
			billing.PlanTypeInactive,
		}).Draw(t, "plan")
		effort := rapid.SampledFrom([]string{
			"", "off", "none", "minimal", "low", "medium", "high", "unknown-tier",
		}).Draw(t, "effort")

		model := catalogue.Model{MaxOutputTokens: modelMax}
		maxOutput, budget := reasoningOutputPlan(requested, model, plan, effort)

		if model.MaxOutputTokens > 0 && maxOutput > model.MaxOutputTokens {
			t.Fatalf("maxOutput = %d, want <= model cap %d", maxOutput, model.MaxOutputTokens)
		}
		if budget < 0 {
			t.Fatalf("budget = %d, want >= 0", budget)
		}
		if maxOutput <= 0 {
			t.Fatalf("maxOutput = %d, want > 0", maxOutput)
		}

		switch effort {
		case "", "off", "none":
			if budget != 0 {
				t.Fatalf("budget = %d for effort %q, want 0", budget, effort)
			}
			wantMax := effectiveMaxOutputTokens(requested, model, plan)
			if maxOutput != wantMax {
				t.Fatalf("maxOutput = %d, want %d for reasoning-off effort %q", maxOutput, wantMax, effort)
			}
		default:
			if budget >= maxOutput {
				t.Fatalf("budget = %d, maxOutput = %d, want budget < maxOutput", budget, maxOutput)
			}
		}
	})
}
