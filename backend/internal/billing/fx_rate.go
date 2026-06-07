package billing

import (
	"os"
	"strconv"
	"strings"
)

const (
	DefaultFXRateFallbackUSDCHF = 0.88
	envFXRateFallbackUSDCHF     = "BILLING_FX_RATE_FALLBACK_USD_CHF"
)

type FXRateProvider interface {
	USDToCHF() float64
}

type StaticFXRateProvider struct {
	Rate float64
}

func (p StaticFXRateProvider) USDToCHF() float64 {
	if p.Rate <= 0 {
		return DefaultFXRateFallbackUSDCHF
	}
	return p.Rate
}

func NewFallbackFXRateProvider() FXRateProvider {
	return StaticFXRateProvider{Rate: fallbackFXRateFromEnv()}
}

func fallbackFXRateFromEnv() float64 {
	raw := strings.TrimSpace(os.Getenv(envFXRateFallbackUSDCHF))
	if raw == "" {
		return DefaultFXRateFallbackUSDCHF
	}

	rate, err := strconv.ParseFloat(raw, 64)
	if err != nil || rate <= 0 {
		return DefaultFXRateFallbackUSDCHF
	}

	return rate
}
