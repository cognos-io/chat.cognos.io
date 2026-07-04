package gateway

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// groundingTestServer serves a redirect maze for the resolver tests and counts
// every request it receives (so tests can assert zero calls for non-matching
// URLs). Paths under /r/ model the grounding-redirect prefix.
func groundingTestServer(t *testing.T) (*httptest.Server, *int64) {
	t.Helper()
	var hits int64
	mux := http.NewServeMux()
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	redirect := func(w http.ResponseWriter, location string) {
		w.Header().Set("Location", location)
		w.WriteHeader(http.StatusFound)
	}

	mux.HandleFunc("/r/", func(w http.ResponseWriter, req *http.Request) {
		atomic.AddInt64(&hits, 1)
		switch req.URL.Path {
		case "/r/single":
			redirect(w, "https://dest.example/single-page")
		case "/r/h0":
			redirect(w, srv.URL+"/r/h1") // on-host hop 1
		case "/r/h1":
			redirect(w, srv.URL+"/r/h2") // on-host hop 2
		case "/r/h2":
			redirect(w, "https://dest.example/after-two-hops") // off-host destination
		case "/r/loop":
			redirect(w, srv.URL+"/r/loop") // infinite on-host loop
		case "/r/expired":
			w.WriteHeader(http.StatusNotFound)
		case "/r/slow":
			time.Sleep(500 * time.Millisecond)
			redirect(w, "https://dest.example/slow")
		case "/r/js":
			redirect(w, "javascript:alert(1)") // off-host, non-http scheme
		case "/r/rel":
			redirect(w, "/r/relTarget") // relative → resolves on-host
		case "/r/relTarget":
			w.WriteHeader(http.StatusOK) // ends on-host at 200, no destination
		default:
			w.WriteHeader(http.StatusOK)
		}
	})
	// A path OUTSIDE the /r/ prefix, to prove non-matching URLs are never fetched.
	mux.HandleFunc("/other/", func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt64(&hits, 1)
		w.WriteHeader(http.StatusOK)
	})
	return srv, &hits
}

func newTestResolver(prefix string, perURL, total time.Duration) *HTTPGroundingResolver {
	host := ""
	if u, err := url.Parse(prefix); err == nil {
		host = u.Host
	}
	return &HTTPGroundingResolver{
		prefix:      prefix,
		prefixHost:  host,
		perURL:      perURL,
		total:       total,
		concurrency: 4,
		maxHops:     2,
	}
}

func TestGroundingResolverCases(t *testing.T) {
	t.Parallel()

	srv, _ := groundingTestServer(t)
	prefix := srv.URL + "/r/"
	r := newTestResolver(prefix, time.Second, 3*time.Second)

	cases := []struct {
		name    string
		path    string
		wantURL string // "" → keep the original proxy URL
	}{
		{name: "single 302 hop resolves", path: "/r/single", wantURL: "https://dest.example/single-page"},
		{name: "two on-prefix hops then off-host resolves", path: "/r/h0", wantURL: "https://dest.example/after-two-hops"},
		{name: "redirect loop beyond max hops keeps proxy", path: "/r/loop", wantURL: ""},
		{name: "expired 404 keeps proxy", path: "/r/expired", wantURL: ""},
		{name: "non-http(s) destination keeps proxy", path: "/r/js", wantURL: ""},
		{name: "relative destination staying on-host keeps proxy", path: "/r/rel", wantURL: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			proxy := srv.URL + tc.path
			out, resolved, failed := r.Resolve(context.Background(), []Citation{{URL: proxy, Title: "t"}})
			want := tc.wantURL
			if want == "" {
				want = proxy
			}
			if out[0].URL != want {
				t.Fatalf("URL = %q, want %q", out[0].URL, want)
			}
			if out[0].Title != "t" {
				t.Fatalf("title = %q, want it preserved", out[0].Title)
			}
			if tc.wantURL != "" {
				if resolved != 1 || failed != 0 {
					t.Fatalf("counts resolved=%d failed=%d, want 1/0", resolved, failed)
				}
			} else if resolved != 0 || failed != 1 {
				t.Fatalf("counts resolved=%d failed=%d, want 0/1", resolved, failed)
			}
		})
	}
}

func TestGroundingResolverNonMatchingURLMakesNoRequest(t *testing.T) {
	t.Parallel()

	srv, hits := groundingTestServer(t)
	r := newTestResolver(srv.URL+"/r/", time.Second, 3*time.Second)

	// A URL under the SAME host but outside the prefix, plus a fully external one.
	in := []Citation{
		{URL: srv.URL + "/other/thing", Title: "a"},
		{URL: "https://real.example/page", Title: "b"},
	}
	out, resolved, failed := r.Resolve(context.Background(), in)
	if resolved != 0 || failed != 0 {
		t.Fatalf("counts resolved=%d failed=%d, want 0/0 for non-matching URLs", resolved, failed)
	}
	if out[0].URL != in[0].URL || out[1].URL != in[1].URL {
		t.Fatalf("non-matching URLs must pass through untouched: %#v", out)
	}
	if got := atomic.LoadInt64(hits); got != 0 {
		t.Fatalf("server saw %d requests, want 0 (non-matching URLs never fetched)", got)
	}
}

func TestGroundingResolverTimeoutKeepsProxy(t *testing.T) {
	t.Parallel()

	srv, _ := groundingTestServer(t)
	// per-URL timeout well below the server's 500ms sleep.
	r := newTestResolver(srv.URL+"/r/", 60*time.Millisecond, 3*time.Second)

	proxy := srv.URL + "/r/slow"
	out, resolved, failed := r.Resolve(context.Background(), []Citation{{URL: proxy}})
	if out[0].URL != proxy {
		t.Fatalf("URL = %q, want the proxy kept on timeout", out[0].URL)
	}
	if resolved != 0 || failed != 1 {
		t.Fatalf("counts resolved=%d failed=%d, want 0/1", resolved, failed)
	}
}

func TestGroundingResolverWholeBudgetKeepsProxies(t *testing.T) {
	t.Parallel()

	srv, _ := groundingTestServer(t)
	// Whole-completion budget shorter than a single slow fetch: everything times
	// out and keeps its proxy, and Resolve returns near the budget (not N×perURL).
	r := newTestResolver(srv.URL+"/r/", time.Second, 120*time.Millisecond)

	in := make([]Citation, 8)
	for i := range in {
		in[i] = Citation{URL: srv.URL + "/r/slow"}
	}
	start := time.Now()
	out, resolved, _ := r.Resolve(context.Background(), in)
	elapsed := time.Since(start)

	if resolved != 0 {
		t.Fatalf("resolved = %d, want 0 (all exceed the budget)", resolved)
	}
	for i := range out {
		if out[i].URL != srv.URL+"/r/slow" {
			t.Fatalf("citation %d = %q, want the proxy kept", i, out[i].URL)
		}
	}
	if elapsed > 600*time.Millisecond {
		t.Fatalf("Resolve took %v, want it bounded near the whole-completion budget", elapsed)
	}
}

func TestGroundingResolverConcurrentResolution(t *testing.T) {
	t.Parallel()

	srv, hits := groundingTestServer(t)
	r := newTestResolver(srv.URL+"/r/", time.Second, 3*time.Second)

	in := []Citation{
		{URL: srv.URL + "/r/single"},
		{URL: srv.URL + "/r/h0"},
		{URL: "https://real.example/keep"},
		{URL: srv.URL + "/r/single"},
	}
	out, resolved, failed := r.Resolve(context.Background(), in)
	if resolved != 3 || failed != 0 {
		t.Fatalf("counts resolved=%d failed=%d, want 3/0", resolved, failed)
	}
	if out[0].URL != "https://dest.example/single-page" ||
		out[1].URL != "https://dest.example/after-two-hops" ||
		out[2].URL != "https://real.example/keep" ||
		out[3].URL != "https://dest.example/single-page" {
		t.Fatalf("resolved set = %#v", out)
	}
	// single(1) + h0/h1/h2(3) + single(1) = 5 fetches; the external URL is never hit.
	if got := atomic.LoadInt64(hits); got != 5 {
		t.Fatalf("server saw %d requests, want 5", got)
	}
}

func TestGroundingResolverNilAndEmpty(t *testing.T) {
	t.Parallel()

	var r *HTTPGroundingResolver
	out, res, fail := r.Resolve(context.Background(), []Citation{{URL: "https://x/y"}})
	if len(out) != 1 || res != 0 || fail != 0 {
		t.Fatalf("nil resolver must pass through: out=%#v res=%d fail=%d", out, res, fail)
	}

	r2 := NewHTTPGroundingResolver("", nil)
	if r2.prefix != DefaultGroundingRedirectPrefix {
		t.Fatalf("empty prefix should default to the real Vertex prefix, got %q", r2.prefix)
	}
	if out, res, fail := r2.Resolve(context.Background(), nil); out != nil || res != 0 || fail != 0 {
		t.Fatalf("empty citations must no-op: out=%#v res=%d fail=%d", out, res, fail)
	}
}

func TestBifrostClientResolveCitationsNilResolver(t *testing.T) {
	t.Parallel()

	c := NewBifrostClient(&stubBifrostRequester{}, nil, nil, nil)
	in := []Citation{{URL: strings.Repeat("x", 3)}}
	if got := c.resolveCitations(context.Background(), in); len(got) != 1 || got[0].URL != in[0].URL {
		t.Fatalf("nil resolver must pass through citations, got %#v", got)
	}
}
