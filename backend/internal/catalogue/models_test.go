package catalogue

import "testing"

func TestGetModelByID(t *testing.T) {
	t.Parallel()

	got, ok := GetModelByID("llama-3-3-infomaniak")
	if !ok {
		t.Fatal("GetModelByID(llama-3-3-infomaniak) ok = false, want true")
	}
	if got.ProviderID != "infomaniak" {
		t.Errorf("GetModelByID(llama-3-3-infomaniak) provider = %q, want %q", got.ProviderID, "infomaniak")
	}
}

func TestGetModelByIDMissing(t *testing.T) {
	t.Parallel()

	_, ok := GetModelByID("missing")
	if ok {
		t.Fatal("GetModelByID(missing) ok = true, want false")
	}
}

func TestActiveModels(t *testing.T) {
	t.Parallel()

	got := ActiveModels()
	if len(got) != 1 {
		t.Fatalf("ActiveModels() len = %d, want %d", len(got), 1)
	}
	if !got[0].IsActive {
		t.Errorf("ActiveModels()[0].IsActive = %t, want true", got[0].IsActive)
	}
}

func TestModelsAvailableForTier(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		userTier PrivacyTier
		wantLen  int
	}{
		{name: "strictest tier", userTier: PrivacyTierCHOnly, wantLen: 1},
		{name: "eu tier", userTier: PrivacyTierEU, wantLen: 1},
		{name: "global tier", userTier: PrivacyTierGlobal, wantLen: 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := ModelsAvailableForTier(tt.userTier)
			if len(got) != tt.wantLen {
				t.Fatalf("ModelsAvailableForTier(%q) len = %d, want %d", tt.userTier, len(got), tt.wantLen)
			}
		})
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
