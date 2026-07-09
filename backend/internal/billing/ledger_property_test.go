package billing

import (
	"testing"

	"pgregory.net/rapid"
)

// Property: BuildUsageRecord preserves the usage counters and billing sign
// conventions across every plan type. Unlimited should never record an amount,
// while metered plans should negate the precise user cost and trial should
// also compute the post-turn balance deterministically.
func TestBuildUsageRecordProperties(t *testing.T) {
	t.Parallel()

	service := NewService()

	rapid.Check(t, func(t *rapid.T) {
		plan := rapid.SampledFrom([]PlanType{
			PlanTypeTrial,
			PlanTypePayG,
			PlanTypeUnlimited,
		}).Draw(t, "plan")
		costMicro := rapid.Int64Range(0, 50_000_000).Draw(t, "costMicro")
		balanceMicro := rapid.Int64Range(0, 500_000_000).Draw(t, "balanceMicro")
		operationType := rapid.SampledFrom([]OperationType{"", OperationTypeText, OperationTypeImageGeneration}).Draw(t, "operationType")
		searchCount := rapid.Int64Range(0, 5).Draw(t, "searchCount")
		imageCount := rapid.Int64Range(0, 3).Draw(t, "imageCount")

		cost := CostBreakdown{
			CostRappen:               CeilRappenFromMicro(costMicro),
			CostMicroRappen:          costMicro,
			ProviderCostUSD:          0,
			ProviderCostMicroRappen:  0,
			InputTokens:              123,
			OutputTokens:             456,
			CacheCreationInputTokens: 7,
			CacheReadInputTokens:     8,
			SearchCount:              searchCount,
		}
		state := State{
			PlanType:           plan,
			BalanceRappen:      FloorRappenFromMicro(balanceMicro),
			BalanceMicroRappen: balanceMicro,
		}

		got := service.BuildUsageRecord(state, BuildUsageRecordInput{
			UserID:              "user-1",
			EventID:             "event-1",
			ModelID:             "model-1",
			Cost:                cost,
			FXRateUSDCHF:        1,
			InputTokens:         123,
			OutputTokens:        456,
			OperationType:       operationType,
			GeneratedImageCount: imageCount,
			SearchCount:         searchCount,
		})

		if got.Type != UsageTransactionType {
			t.Fatalf("Type = %q, want %q", got.Type, UsageTransactionType)
		}
		if got.OperationType == "" {
			t.Fatalf("OperationType = %q, want defaulted value", got.OperationType)
		}
		if got.SearchCount != searchCount {
			t.Fatalf("SearchCount = %d, want %d", got.SearchCount, searchCount)
		}
		if got.GeneratedImageCount != imageCount {
			t.Fatalf("GeneratedImageCount = %d, want %d", got.GeneratedImageCount, imageCount)
		}
		if got.InputTokens != 123 || got.OutputTokens != 456 {
			t.Fatalf("token counters changed: input=%d output=%d", got.InputTokens, got.OutputTokens)
		}

		switch plan {
		case PlanTypeUnlimited:
			if got.AmountRappen != 0 || got.AmountMicroRappen != 0 {
				t.Fatalf("unlimited plan recorded amount rappen=%d micro=%d, want zero", got.AmountRappen, got.AmountMicroRappen)
			}
			if got.BalanceAfterRappen != nil || got.BalanceAfterMicroRappen != nil {
				t.Fatalf("unlimited plan recorded balance after fields: %#v %#v", got.BalanceAfterRappen, got.BalanceAfterMicroRappen)
			}
		case PlanTypeTrial, PlanTypePayG:
			if got.AmountRappen != -cost.CostRappen {
				t.Fatalf("AmountRappen = %d, want %d", got.AmountRappen, -cost.CostRappen)
			}
			if got.AmountMicroRappen != -cost.CostMicroRappen {
				t.Fatalf("AmountMicroRappen = %d, want %d", got.AmountMicroRappen, -cost.CostMicroRappen)
			}
			if plan == PlanTypeTrial {
				if got.BalanceAfterRappen == nil || got.BalanceAfterMicroRappen == nil {
					t.Fatalf("trial plan did not record post-turn balance")
				}
				wantMicro := balanceMicro - costMicro
				wantRappen := FloorRappenFromMicro(wantMicro)
				if *got.BalanceAfterMicroRappen != wantMicro {
					t.Fatalf("BalanceAfterMicroRappen = %d, want %d", *got.BalanceAfterMicroRappen, wantMicro)
				}
				if *got.BalanceAfterRappen != wantRappen {
					t.Fatalf("BalanceAfterRappen = %d, want %d", *got.BalanceAfterRappen, wantRappen)
				}
			} else if got.BalanceAfterRappen != nil || got.BalanceAfterMicroRappen != nil {
				t.Fatalf("payg plan unexpectedly recorded balance after fields: %#v %#v", got.BalanceAfterRappen, got.BalanceAfterMicroRappen)
			}
		}
	})
}
