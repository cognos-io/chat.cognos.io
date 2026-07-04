package gateway

import (
	"context"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// DefaultGroundingRedirectPrefix is Vertex/Gemini's grounding-redirect prefix.
// Citations from Gemini carry URLs under this prefix that route the user through
// Google and expire after ~30 days; we resolve them to their destination per
// completion so the sealed history holds a durable, direct link.
const DefaultGroundingRedirectPrefix = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/"

// GroundingResolver rewrites grounding-redirect citation URLs to their
// destination. Implementations MUST fetch only prefix-matching URLs (never the
// destination, never arbitrary input), MUST NOT cache or store any
// redirect→destination mapping, and MUST NOT log any URL.
type GroundingResolver interface {
	// Resolve returns citations with prefix-matching URLs replaced by their
	// resolved destination (non-matching URLs are returned untouched, with zero
	// HTTP calls). resolvedCount/failedCount are for count-only logging.
	Resolve(ctx context.Context, citations []Citation) (resolved []Citation, resolvedCount, failedCount int)
}

// HTTPGroundingResolver resolves grounding-redirect URLs with a single, bounded
// HTTP GET per URL. It only ever fetches URLs under its configured prefix and
// only follows redirects while they stay on the prefix host; the first off-host
// Location is treated as the (unfetched) destination.
type HTTPGroundingResolver struct {
	prefix      string
	prefixHost  string
	perURL      time.Duration
	total       time.Duration
	concurrency int
	maxHops     int
	logger      *slog.Logger
}

// NewHTTPGroundingResolver builds a resolver for the given redirect prefix
// (empty → DefaultGroundingRedirectPrefix) with the documented budgets.
func NewHTTPGroundingResolver(prefix string, logger *slog.Logger) *HTTPGroundingResolver {
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		prefix = DefaultGroundingRedirectPrefix
	}
	host := ""
	if u, err := url.Parse(prefix); err == nil {
		host = u.Host
	}
	return &HTTPGroundingResolver{
		prefix:      prefix,
		prefixHost:  host,
		perURL:      1500 * time.Millisecond,
		total:       3 * time.Second,
		concurrency: 4,
		maxHops:     2,
		logger:      logger,
	}
}

// Resolve rewrites prefix-matching citation URLs to their destination,
// concurrently and within the whole-completion budget. Non-matching URLs are
// left untouched with zero HTTP calls. On any timeout/error/expiry/non-redirect
// the original proxy URL is kept.
func (r *HTTPGroundingResolver) Resolve(ctx context.Context, citations []Citation) ([]Citation, int, int) {
	if r == nil || len(citations) == 0 {
		return citations, 0, 0
	}

	var targets []int
	for i := range citations {
		if strings.HasPrefix(citations[i].URL, r.prefix) {
			targets = append(targets, i)
		}
	}
	if len(targets) == 0 {
		return citations, 0, 0 // nothing to resolve → zero HTTP calls
	}

	out := make([]Citation, len(citations))
	copy(out, citations)

	budgetCtx, cancel := context.WithTimeout(ctx, r.total)
	defer cancel()

	var resolved, failed int64
	sem := make(chan struct{}, r.concurrency)
	var wg sync.WaitGroup
	var mu sync.Mutex
	for _, idx := range targets {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			if dest, ok := r.resolveOne(budgetCtx, citations[i].URL); ok {
				mu.Lock()
				out[i].URL = dest
				mu.Unlock()
				atomic.AddInt64(&resolved, 1)
			} else {
				atomic.AddInt64(&failed, 1)
			}
		}(idx)
	}
	wg.Wait()

	return out, int(resolved), int(failed)
}

// resolveOne performs the single bounded GET for one proxy URL and returns the
// off-host destination, or ok=false to keep the proxy. It never fetches the
// destination, sends no cookies/auth, and never logs the URL.
func (r *HTTPGroundingResolver) resolveOne(ctx context.Context, proxyURL string) (string, bool) {
	reqCtx, cancel := context.WithTimeout(ctx, r.perURL)
	defer cancel()

	var dest *url.URL
	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			// Follow redirects only while they stay on the allowlisted prefix host,
			// and only up to maxHops. The first off-host Location is the
			// destination — capture it and stop WITHOUT fetching it (SSRF guard).
			if req.URL.Host == r.prefixHost {
				if len(via) > r.maxHops {
					return http.ErrUseLastResponse
				}
				return nil
			}
			dest = req.URL
			return http.ErrUseLastResponse
		},
	}

	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodGet, proxyURL, nil)
	if err != nil {
		return "", false
	}
	httpReq.Header.Set("Accept", "*/*")

	resp, err := client.Do(httpReq)
	if err != nil {
		return "", false
	}
	// Never read the body — we only need the redirect Location.
	_ = resp.Body.Close()

	if dest != nil && isResolvableHTTPURL(dest) {
		return dest.String(), true
	}
	return "", false
}

// isResolvableHTTPURL accepts only absolute http(s) URLs with a host; anything
// else (relative, javascript:, data:, …) is rejected so the proxy is kept.
func isResolvableHTTPURL(u *url.URL) bool {
	if u == nil || !u.IsAbs() {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	return u.Host != ""
}
