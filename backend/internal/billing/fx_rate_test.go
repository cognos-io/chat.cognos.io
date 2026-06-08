package billing

import (
	"sync"
	"testing"
	"time"
)

type countingFXRateProvider struct {
	mu    sync.Mutex
	rates []float64
	calls int
}

func (p *countingFXRateProvider) USDToCHF() float64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	idx := p.calls
	if idx >= len(p.rates) {
		idx = len(p.rates) - 1
	}
	p.calls++
	return p.rates[idx]
}

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

func TestCachedFXRateProviderCachesWithinTTL(t *testing.T) {
	t.Parallel()

	upstream := &countingFXRateProvider{rates: []float64{0.91, 0.95}}
	now := time.Unix(0, 0)
	clock := func() time.Time { return now }

	provider := NewCachedFXRateProvider(upstream, time.Hour, clock)

	if got := provider.USDToCHF(); got != 0.91 {
		t.Fatalf("first USDToCHF() = %f, want 0.91", got)
	}

	now = now.Add(30 * time.Minute)
	if got := provider.USDToCHF(); got != 0.91 {
		t.Errorf("cached USDToCHF() = %f, want 0.91", got)
	}
	if upstream.calls != 1 {
		t.Errorf("upstream calls = %d, want 1 (cache hit expected)", upstream.calls)
	}
}

func TestCachedFXRateProviderRefreshesAfterTTL(t *testing.T) {
	t.Parallel()

	upstream := &countingFXRateProvider{rates: []float64{0.91, 0.95}}
	now := time.Unix(0, 0)
	clock := func() time.Time { return now }

	provider := NewCachedFXRateProvider(upstream, time.Hour, clock)
	provider.USDToCHF()

	now = now.Add(time.Hour + time.Second)
	if got := provider.USDToCHF(); got != 0.95 {
		t.Errorf("expired USDToCHF() = %f, want 0.95 from refreshed upstream", got)
	}
	if upstream.calls != 2 {
		t.Errorf("upstream calls = %d, want 2 (refresh expected)", upstream.calls)
	}
}

func TestCachedFXRateProviderFallsBackWhenUpstreamInvalid(t *testing.T) {
	t.Parallel()

	upstream := &countingFXRateProvider{rates: []float64{0}}
	provider := NewCachedFXRateProvider(upstream, time.Hour, nil)

	if got := provider.USDToCHF(); got != DefaultFXRateFallbackUSDCHF {
		t.Errorf("USDToCHF() = %f, want fallback %f", got, DefaultFXRateFallbackUSDCHF)
	}
}

func TestCachedFXRateProviderTolerantNilUpstream(t *testing.T) {
	t.Parallel()

	provider := NewCachedFXRateProvider(nil, time.Hour, nil)
	if got := provider.USDToCHF(); got != DefaultFXRateFallbackUSDCHF {
		t.Errorf("USDToCHF() = %f, want fallback %f", got, DefaultFXRateFallbackUSDCHF)
	}
}
