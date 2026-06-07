package billing

import (
	"testing"
)

func TestStaticFXRateProviderReturnsConfiguredRate(t *testing.T) {
	t.Parallel()

	provider := StaticFXRateProvider{Rate: 0.91}
	if got := provider.USDToCHF(); got != 0.91 {
		t.Errorf("USDToCHF() = %f, want %f", got, 0.91)
	}
}

func TestStaticFXRateProviderFallsBackWhenRateInvalid(t *testing.T) {
	t.Parallel()

	provider := StaticFXRateProvider{Rate: 0}
	if got := provider.USDToCHF(); got != DefaultFXRateFallbackUSDCHF {
		t.Errorf("USDToCHF() = %f, want %f", got, DefaultFXRateFallbackUSDCHF)
	}
}

func TestFallbackFXRateProviderUsesDefaultWhenEnvUnset(t *testing.T) {
	t.Setenv(envFXRateFallbackUSDCHF, "")

	provider := NewFallbackFXRateProvider()
	if got := provider.USDToCHF(); got != DefaultFXRateFallbackUSDCHF {
		t.Errorf("USDToCHF() = %f, want %f", got, DefaultFXRateFallbackUSDCHF)
	}
}

func TestFallbackFXRateProviderUsesEnvOverride(t *testing.T) {
	t.Setenv(envFXRateFallbackUSDCHF, "0.93")

	provider := NewFallbackFXRateProvider()
	if got := provider.USDToCHF(); got != 0.93 {
		t.Errorf("USDToCHF() = %f, want %f", got, 0.93)
	}
}
