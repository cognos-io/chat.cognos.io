package analytics

import (
	"reflect"
	"testing"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
)

func TestBuildUsageEventCapturesUsageAndCostMetadata(t *testing.T) {
	t.Parallel()

	occurredAt := time.Date(2026, 6, 7, 12, 0, 0, 0, time.UTC)
	got := BuildUsageEvent(BuildUsageEventInput{
		EventID:       "evt-1",
		OccurredAt:    occurredAt,
		BillingUserID: "billing-user-1",
		PlanType:      billing.PlanTypePayG,
		Model: catalogue.Model{
			ID:         "llama-3-3-infomaniak",
			ProviderID: "infomaniak",
		},
		PrivacyTier: catalogue.PrivacyTierEU,
		Cost: billing.CostBreakdown{
			InputTokens:              12,
			OutputTokens:             8,
			CacheCreationInputTokens: 1,
			CacheReadInputTokens:     2,
			ProviderCostUSD:          0.25,
			CostUSD:                  0.30,
			CostCHF:                  0.27,
			CostRappen:               27,
			UsedProviderCost:         true,
		},
		FXRateUSDCHF: 0.9,
		LatencyMS:    321,
	})

	if got.BillingPeriod != "2026-06" {
		t.Errorf("BuildUsageEvent(...).BillingPeriod = %q, want %q", got.BillingPeriod, "2026-06")
	}
	if got.CacheCreationInputTokens != 1 {
		t.Errorf("BuildUsageEvent(...).CacheCreationInputTokens = %d, want %d", got.CacheCreationInputTokens, 1)
	}
	if got.CacheReadInputTokens != 2 {
		t.Errorf("BuildUsageEvent(...).CacheReadInputTokens = %d, want %d", got.CacheReadInputTokens, 2)
	}
	if !got.UsedProviderCost {
		t.Error("BuildUsageEvent(...).UsedProviderCost = false, want true")
	}
	if got.CostCHF != 0.27 {
		t.Errorf("BuildUsageEvent(...).CostCHF = %f, want %f", got.CostCHF, 0.27)
	}
	if got.LatencyMS != 321 {
		t.Errorf("BuildUsageEvent(...).LatencyMS = %d, want %d", got.LatencyMS, 321)
	}
}

func TestUsageEventSchemaExcludesPlaintextAndDirectIdentifiers(t *testing.T) {
	t.Parallel()

	fields := map[string]struct{}{}
	usageEventType := reflect.TypeOf(UsageEvent{})
	for i := 0; i < usageEventType.NumField(); i++ {
		fields[usageEventType.Field(i).Name] = struct{}{}
	}

	for _, forbidden := range []string{"UserID", "Email", "Content", "ConversationID", "MessageID"} {
		if _, ok := fields[forbidden]; ok {
			t.Fatalf("UsageEvent contains forbidden field %q", forbidden)
		}
	}

	got := BuildUsageEvent(BuildUsageEventInput{
		EventID:       "evt-2",
		BillingUserID: "billing-user-2",
		PlanType:      billing.PlanTypeTrial,
		Model:         catalogue.Model{ID: "llama-3-3-infomaniak", ProviderID: "infomaniak"},
		PrivacyTier:   catalogue.PrivacyTierCHOnly,
		Cost: billing.CostBreakdown{
			InputTokens:  1,
			OutputTokens: 1,
		},
		FXRateUSDCHF: 1,
	})

	if got.EventID == "" || got.BillingUserID == "" {
		t.Fatal("expected opaque billing identifiers only")
	}
}
