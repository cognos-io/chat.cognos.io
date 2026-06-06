package main

import (
	"errors"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/pkg/proxy"
)

type staticUpstreamRepo struct {
	err error
}

func (r staticUpstreamRepo) Provider(_ string) (proxy.Upstream, error) {
	if r.err != nil {
		return nil, r.err
	}
	return stubUpstream{}, nil
}

func TestEnsureActiveProvidersAvailable(t *testing.T) {
	t.Parallel()

	if err := ensureActiveProvidersAvailable(staticUpstreamRepo{}); err != nil {
		t.Fatalf("ensureActiveProvidersAvailable() error = %v, want nil", err)
	}
}

func TestEnsureActiveProvidersAvailableReturnsProviderError(t *testing.T) {
	t.Parallel()

	wantErr := errors.New("provider unavailable")
	if err := ensureActiveProvidersAvailable(staticUpstreamRepo{err: wantErr}); !errors.Is(err, wantErr) {
		t.Fatalf("ensureActiveProvidersAvailable() error = %v, want wrapped %v", err, wantErr)
	}
}
