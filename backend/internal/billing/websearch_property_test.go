package billing

import (
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
	"pgregory.net/rapid"
)

// modelGen draws a catalogue model with non-negative token pricing.
func modelGen(t *rapid.T) catalogue.Model {
	return catalogue.Model{
		Pricing: catalogue.Pricing{
			InputUSDPerMillionTokens:  rapid.Float64Range(0, 50).Draw(t, "inPrice"),
			OutputUSDPerMillionTokens: rapid.Float64Range(0, 100).Draw(t, "outPrice"),
		},
	}
}

// Property: cost is monotonic non-decreasing in each of input tokens, output
// tokens and search count — bumping any one dimension (all else equal) never
// lowers the metered micro-rappen cost.
func TestCalculateCostMonotonicProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		model := modelGen(t)
		floor := rapid.Int64Range(1, 5_000_000).Draw(t, "floor")
		service := NewServiceWithOptions(DefaultMarginBPS, floor)
		fx := rapid.Float64Range(0.1, 3).Draw(t, "fx")

		in := rapid.Int64Range(0, 10_000_000).Draw(t, "in")
		out := rapid.Int64Range(0, 10_000_000).Draw(t, "out")
		searches := rapid.Int64Range(0, 1_000).Draw(t, "searches")

		base := service.CalculateCost(model, Usage{InputTokens: in, OutputTokens: out, SearchCount: searches}, fx)

		moreIn := service.CalculateCost(model, Usage{InputTokens: in + rapid.Int64Range(0, 1_000_000).Draw(t, "dIn"), OutputTokens: out, SearchCount: searches}, fx)
		if moreIn.CostMicroRappen < base.CostMicroRappen {
			t.Fatalf("cost decreased when input tokens rose: %d < %d", moreIn.CostMicroRappen, base.CostMicroRappen)
		}

		moreOut := service.CalculateCost(model, Usage{InputTokens: in, OutputTokens: out + rapid.Int64Range(0, 1_000_000).Draw(t, "dOut"), SearchCount: searches}, fx)
		if moreOut.CostMicroRappen < base.CostMicroRappen {
			t.Fatalf("cost decreased when output tokens rose: %d < %d", moreOut.CostMicroRappen, base.CostMicroRappen)
		}

		moreSearch := service.CalculateCost(model, Usage{InputTokens: in, OutputTokens: out, SearchCount: searches + rapid.Int64Range(0, 100).Draw(t, "dSearch")}, fx)
		if moreSearch.CostMicroRappen < base.CostMicroRappen {
			t.Fatalf("cost decreased when search count rose: %d < %d", moreSearch.CostMicroRappen, base.CostMicroRappen)
		}

		if base.CostMicroRappen < 0 {
			t.Fatalf("cost went negative: %d", base.CostMicroRappen)
		}
	})
}

// Property: the search fee is exactly additive — the micro-rappen cost of n
// searches minus the cost of zero searches equals n × floor, precisely, whether
// or not a provider cost is trusted. (Adding an integer number of micro-rappen
// to the CHF total shifts the rounded result by exactly that integer.)
func TestCalculateCostSearchFeeExactlyAdditiveProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		model := modelGen(t)
		floor := rapid.Int64Range(1, 5_000_000).Draw(t, "floor")
		service := NewServiceWithOptions(DefaultMarginBPS, floor)
		fx := rapid.Float64Range(0.1, 3).Draw(t, "fx")
		in := rapid.Int64Range(0, 10_000_000).Draw(t, "in")
		out := rapid.Int64Range(0, 10_000_000).Draw(t, "out")
		n := rapid.Int64Range(0, 5_000).Draw(t, "n")

		var providerCost *float64
		if rapid.Bool().Draw(t, "hasProviderCost") {
			c := rapid.Float64Range(0, 5).Draw(t, "providerCost")
			providerCost = &c
		}

		zero := service.CalculateCost(model, Usage{InputTokens: in, OutputTokens: out, ProviderCostUSD: providerCost, SearchCount: 0}, fx)
		withN := service.CalculateCost(model, Usage{InputTokens: in, OutputTokens: out, ProviderCostUSD: providerCost, SearchCount: n}, fx)

		if got, want := withN.CostMicroRappen-zero.CostMicroRappen, n*floor; got != want {
			t.Fatalf("search fee delta = %d micro-rappen, want %d (n=%d floor=%d)", got, want, n, floor)
		}
		if withN.SearchCount != n {
			t.Fatalf("breakdown SearchCount = %d, want %d", withN.SearchCount, n)
		}
	})
}

// Property: whatever int64 is configured, the resolved floor is strictly
// positive — search is never silently free (non-positive falls back to the
// baked-in default).
func TestNewServiceWithOptionsFloorAlwaysPositiveProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		floor := rapid.Int64().Draw(t, "floor")
		service := NewServiceWithOptions(DefaultMarginBPS, floor)
		if service.WebSearchFloorMicroRappen <= 0 {
			t.Fatalf("resolved floor = %d for input %d, want > 0", service.WebSearchFloorMicroRappen, floor)
		}
		if floor > 0 && service.WebSearchFloorMicroRappen != floor {
			t.Fatalf("positive floor %d not honoured (got %d)", floor, service.WebSearchFloorMicroRappen)
		}
	})
}

// A large-but-realistic search count stays correct and positive — the fee does
// not overflow int64 at any count a stream could plausibly produce.
func TestCalculateCostLargeSearchCountStaysCorrect(t *testing.T) {
	t.Parallel()

	service := NewService()
	model := catalogue.Model{Pricing: catalogue.Pricing{InputUSDPerMillionTokens: 1, OutputUSDPerMillionTokens: 2}}

	const huge = int64(10_000_000) // far beyond any real stream; 10M * 900k = 9e12 << 2^53
	zero := service.CalculateCost(model, Usage{InputTokens: 100, OutputTokens: 200, SearchCount: 0}, 0.9)
	got := service.CalculateCost(model, Usage{InputTokens: 100, OutputTokens: 200, SearchCount: huge}, 0.9)

	if got.CostMicroRappen <= 0 {
		t.Fatalf("cost = %d, want positive (no overflow)", got.CostMicroRappen)
	}
	if delta, want := got.CostMicroRappen-zero.CostMicroRappen, huge*DefaultWebSearchFloorMicroRappen; delta != want {
		t.Fatalf("fee for %d searches = %d micro-rappen, want %d", huge, delta, want)
	}
}
