package billing

import (
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
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

// DefaultFXRateCacheTTL is the cache window for the live USD→CHF rate.
// 24 hours matches the spec's "refreshed daily" guidance.
const DefaultFXRateCacheTTL = 24 * time.Hour

// CachedFXRateProvider memoises an upstream provider's USD→CHF rate for a TTL
// and refreshes on the next read after expiry. The wrapper is safe for
// concurrent use and uses an injectable clock so tests can advance time
// without sleeping.
type CachedFXRateProvider struct {
	upstream FXRateProvider
	ttl      time.Duration
	now      func() time.Time

	mu      sync.Mutex
	rate    float64
	loadedAt time.Time
}

// NewCachedFXRateProvider wraps the given provider with a TTL cache. A
// non-positive ttl falls back to DefaultFXRateCacheTTL. Passing nil as the
// clock falls back to time.Now.
func NewCachedFXRateProvider(upstream FXRateProvider, ttl time.Duration, now func() time.Time) *CachedFXRateProvider {
	if ttl <= 0 {
		ttl = DefaultFXRateCacheTTL
	}
	if now == nil {
		now = time.Now
	}
	return &CachedFXRateProvider{upstream: upstream, ttl: ttl, now: now}
}

// USDToCHF returns the cached upstream rate, refreshing it when the cache is
// empty or older than the configured TTL. If the upstream returns a
// non-positive rate, the cache falls back to DefaultFXRateFallbackUSDCHF so
// downstream cost calculations never multiply by zero.
func (p *CachedFXRateProvider) USDToCHF() float64 {
	p.mu.Lock()
	defer p.mu.Unlock()

	now := p.now()
	if p.loadedAt.IsZero() || now.Sub(p.loadedAt) >= p.ttl {
		var rate float64
		if p.upstream != nil {
			rate = p.upstream.USDToCHF()
		}
		if rate <= 0 {
			rate = DefaultFXRateFallbackUSDCHF
		}
		p.rate = rate
		p.loadedAt = now
	}
	return p.rate
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
