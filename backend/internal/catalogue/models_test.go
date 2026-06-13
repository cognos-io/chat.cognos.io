package catalogue

import (
	"context"
	"errors"
	"testing"
	"time"
)

type stubRepo struct {
	models []Model
	err    error
	calls  int
}

func (r *stubRepo) ActiveModels(context.Context) ([]Model, error) {
	r.calls++
	if r.err != nil {
		return nil, r.err
	}
	return CloneModels(r.models), nil
}

func TestCachedServiceGetModelByID(t *testing.T) {
	t.Parallel()

	repo := &stubRepo{models: []Model{{
		ID:              "llama-3-3-infomaniak",
		Name:            "Llama 3.3",
		ProviderID:      "infomaniak",
		ProviderModelID: "llama-3.3-70b-instruct",
		PrivacyTier:     PrivacyTierCHOnly,
		NoRetention:     true,
		IsActive:        true,
	}}}
	service := NewCachedService(repo, time.Minute, func() time.Time { return time.Unix(1, 0) })

	got, ok, err := service.GetModelByID(context.Background(), "llama-3-3-infomaniak")
	if err != nil {
		t.Fatalf("GetModelByID() error = %v, want nil", err)
	}
	if !ok {
		t.Fatal("GetModelByID() ok = false, want true")
	}
	if got.ProviderID != "infomaniak" {
		t.Errorf("GetModelByID() provider = %q, want %q", got.ProviderID, "infomaniak")
	}
	if repo.calls != 1 {
		t.Fatalf("ActiveModels() calls = %d, want %d", repo.calls, 1)
	}
}

func TestCachedServiceGetModelByIDMissing(t *testing.T) {
	t.Parallel()

	service := NewCachedService(&stubRepo{}, time.Minute, func() time.Time { return time.Unix(1, 0) })

	_, ok, err := service.GetModelByID(context.Background(), "missing")
	if err != nil {
		t.Fatalf("GetModelByID() error = %v, want nil", err)
	}
	if ok {
		t.Fatal("GetModelByID() ok = true, want false")
	}
}

func TestCachedServiceCachesUntilTTLExpires(t *testing.T) {
	t.Parallel()

	now := time.Unix(1, 0)
	repo := &stubRepo{models: []Model{{ID: "model-a", Name: "Model A", ProviderName: "Provider"}}}
	service := NewCachedService(repo, time.Minute, func() time.Time { return now })

	if _, err := service.ActiveModels(context.Background()); err != nil {
		t.Fatalf("ActiveModels() first call error = %v, want nil", err)
	}
	if _, err := service.ActiveModels(context.Background()); err != nil {
		t.Fatalf("ActiveModels() second call error = %v, want nil", err)
	}
	if repo.calls != 1 {
		t.Fatalf("ActiveModels() calls before ttl = %d, want %d", repo.calls, 1)
	}

	now = now.Add(2 * time.Minute)
	if _, err := service.ActiveModels(context.Background()); err != nil {
		t.Fatalf("ActiveModels() after ttl error = %v, want nil", err)
	}
	if repo.calls != 2 {
		t.Fatalf("ActiveModels() calls after ttl = %d, want %d", repo.calls, 2)
	}
}

func TestCachedServiceInvalidateForcesReload(t *testing.T) {
	t.Parallel()

	now := time.Unix(1, 0)
	repo := &stubRepo{models: []Model{{ID: "model-a", Name: "Model A", ProviderName: "Provider"}}}
	service := NewCachedService(repo, time.Hour, func() time.Time { return now })

	if _, err := service.ActiveModels(context.Background()); err != nil {
		t.Fatalf("ActiveModels() initial call error = %v, want nil", err)
	}
	service.Invalidate()
	if _, err := service.ActiveModels(context.Background()); err != nil {
		t.Fatalf("ActiveModels() after invalidate error = %v, want nil", err)
	}
	if repo.calls != 2 {
		t.Fatalf("ActiveModels() calls = %d, want %d", repo.calls, 2)
	}
}

func TestCachedServiceReturnsRepoError(t *testing.T) {
	t.Parallel()

	wantErr := errors.New("repo unavailable")
	service := NewCachedService(&stubRepo{err: wantErr}, time.Minute, func() time.Time { return time.Unix(1, 0) })

	_, err := service.ActiveModels(context.Background())
	if !errors.Is(err, wantErr) {
		t.Fatalf("ActiveModels() error = %v, want %v", err, wantErr)
	}
}

func TestIsEligibleForTier(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		userTier  PrivacyTier
		modelTier PrivacyTier
		want      bool
	}{
		{name: "ch only user can use ch only", userTier: PrivacyTierCHOnly, modelTier: PrivacyTierCHOnly, want: true},
		{name: "ch only user cannot use eu", userTier: PrivacyTierCHOnly, modelTier: PrivacyTierEU, want: false},
		{name: "eu user can use ch only", userTier: PrivacyTierEU, modelTier: PrivacyTierCHOnly, want: true},
		{name: "eu user can use eu", userTier: PrivacyTierEU, modelTier: PrivacyTierEU, want: true},
		{name: "eu user cannot use global", userTier: PrivacyTierEU, modelTier: PrivacyTierGlobal, want: false},
		{name: "global user can use all", userTier: PrivacyTierGlobal, modelTier: PrivacyTierEU, want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := IsEligibleForTier(tt.userTier, tt.modelTier)
			if got != tt.want {
				t.Errorf("IsEligibleForTier(%q, %q) = %t, want %t", tt.userTier, tt.modelTier, got, tt.want)
			}
		})
	}
}

func TestNormalizePrivacyTier(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		raw  string
		want PrivacyTier
	}{
		{name: "ch only", raw: "ch_only", want: PrivacyTierCHOnly},
		{name: "eu", raw: "eu", want: PrivacyTierEU},
		{name: "global", raw: "global", want: PrivacyTierGlobal},
		{name: "unknown defaults eu", raw: "legacy", want: PrivacyTierEU},
		{name: "empty defaults eu", raw: "", want: PrivacyTierEU},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := NormalizePrivacyTier(tt.raw)
			if got != tt.want {
				t.Errorf("NormalizePrivacyTier(%q) = %q, want %q", tt.raw, got, tt.want)
			}
		})
	}
}
