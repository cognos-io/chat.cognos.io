package billing

import "testing"

import "pgregory.net/rapid"

// Property: the static FX provider is a thin passthrough for positive rates
// and falls back to the configured default whenever the rate is zero or
// negative. That keeps downstream cost calculations from ever multiplying by
// zero.
func TestStaticFXRateProviderProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		if rapid.Bool().Draw(t, "positive") {
			rate := rapid.Float64Range(0.0001, 10).Draw(t, "rate")
			got := StaticFXRateProvider{Rate: rate}.USDToCHF()
			if got != rate {
				t.Fatalf("USDToCHF() = %f, want passthrough %f", got, rate)
			}
			if got <= 0 {
				t.Fatalf("USDToCHF() = %f, want > 0", got)
			}
			return
		}

		rate := rapid.Float64Range(-10, 0).Draw(t, "rate")
		got := StaticFXRateProvider{Rate: rate}.USDToCHF()
		if got != DefaultFXRateFallbackUSDCHF {
			t.Fatalf("USDToCHF() = %f, want fallback %f for invalid rate %f", got, DefaultFXRateFallbackUSDCHF, rate)
		}
	})
}
