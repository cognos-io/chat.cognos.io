package handler

import (
	"testing"
	"time"
)

// validData/validKey are placeholder ciphertext: the pure validators only check
// presence and shape, never decrypt.
const (
	validData = "QUJD"
	validKey  = "a2V5"
)

func okMessage(dupID, sourceID string) copyMessageInput {
	return copyMessageInput{ID: dupID, SourceID: sourceID, Data: validData}
}

func TestBuildCopyIDMap(t *testing.T) {
	t.Parallel()

	// A small branched source tree: root user message u1 with two assistant
	// children a1, a2.
	branched := []sourceMessageMeta{
		{id: "u1", parent: ""},
		{id: "a1", parent: "u1"},
		{id: "a2", parent: "u1"},
	}

	tests := []struct {
		name      string
		source    []sourceMessageMeta
		submitted []copyMessageInput
		wantErr   bool
		// wantMap is checked only when wantErr is false.
		wantMap map[string]string
	}{
		{
			name:   "happy path remaps every source id",
			source: branched,
			submitted: []copyMessageInput{
				okMessage("d1", "u1"),
				okMessage("d2", "a1"),
				okMessage("d3", "a2"),
			},
			wantMap: map[string]string{"u1": "d1", "a1": "d2", "a2": "d3"},
		},
		{
			name:      "empty source and empty bundle is valid",
			source:    []sourceMessageMeta{},
			submitted: []copyMessageInput{},
			wantMap:   map[string]string{},
		},
		{
			name:   "too few messages is rejected",
			source: branched,
			submitted: []copyMessageInput{
				okMessage("d1", "u1"),
				okMessage("d2", "a1"),
			},
			wantErr: true,
		},
		{
			name:   "too many messages is rejected",
			source: branched,
			submitted: []copyMessageInput{
				okMessage("d1", "u1"),
				okMessage("d2", "a1"),
				okMessage("d3", "a2"),
				okMessage("d4", "a2"),
			},
			wantErr: true,
		},
		{
			name:   "foreign source_id is rejected",
			source: branched,
			submitted: []copyMessageInput{
				okMessage("d1", "u1"),
				okMessage("d2", "a1"),
				okMessage("d3", "not-in-source"),
			},
			wantErr: true,
		},
		{
			name:   "duplicate source_id is rejected",
			source: branched,
			submitted: []copyMessageInput{
				okMessage("d1", "u1"),
				okMessage("d2", "a1"),
				okMessage("d3", "a1"),
			},
			wantErr: true,
		},
		{
			name:   "duplicate duplicate-id is rejected",
			source: branched,
			submitted: []copyMessageInput{
				okMessage("d1", "u1"),
				okMessage("d1", "a1"),
				okMessage("d3", "a2"),
			},
			wantErr: true,
		},
		{
			name:   "missing id is rejected",
			source: branched,
			submitted: []copyMessageInput{
				okMessage("d1", "u1"),
				okMessage("d2", "a1"),
				{ID: "", SourceID: "a2", Data: validData},
			},
			wantErr: true,
		},
		{
			name:   "missing data is rejected",
			source: branched,
			submitted: []copyMessageInput{
				okMessage("d1", "u1"),
				okMessage("d2", "a1"),
				{ID: "d3", SourceID: "a2", Data: ""},
			},
			wantErr: true,
		},
		{
			name: "source parent outside the copied set is rejected",
			// u1's parent points at a row that isn't part of the source set —
			// a corrupt source. Every parent must be copyable.
			source: []sourceMessageMeta{
				{id: "u1", parent: "ghost"},
			},
			submitted: []copyMessageInput{okMessage("d1", "u1")},
			wantErr:   true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := buildCopyIDMap(tc.source, tc.submitted)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("buildCopyIDMap() error = nil, want error")
				}
				return
			}
			if err != nil {
				t.Fatalf("buildCopyIDMap() error = %v, want nil", err)
			}
			if len(got) != len(tc.wantMap) {
				t.Fatalf("buildCopyIDMap() map len = %d, want %d", len(got), len(tc.wantMap))
			}
			for k, v := range tc.wantMap {
				if got[k] != v {
					t.Errorf("buildCopyIDMap()[%q] = %q, want %q", k, got[k], v)
				}
			}
		})
	}
}

func TestValidateCopyConversationInput(t *testing.T) {
	t.Parallel()

	valid := copyConversationInput{
		ID:                 "dupconv00000001",
		Data:               validData,
		PublicKey:          validKey,
		PublicKeySignature: validKey,
		WrappedSecretKey:   validKey,
		ExpiryDuration:     "",
	}

	mutate := func(f func(c *copyConversationInput)) copyConversationInput {
		c := valid
		f(&c)
		return c
	}

	tests := []struct {
		name    string
		input   copyConversationInput
		wantErr bool
	}{
		{name: "valid", input: valid},
		{name: "valid with allowed expiry", input: mutate(func(c *copyConversationInput) { c.ExpiryDuration = "168h" })},
		{name: "missing id", input: mutate(func(c *copyConversationInput) { c.ID = " " }), wantErr: true},
		{name: "missing data", input: mutate(func(c *copyConversationInput) { c.Data = "" }), wantErr: true},
		{name: "missing public_key", input: mutate(func(c *copyConversationInput) { c.PublicKey = "" }), wantErr: true},
		{name: "missing signature", input: mutate(func(c *copyConversationInput) { c.PublicKeySignature = "" }), wantErr: true},
		{name: "missing wrapped secret", input: mutate(func(c *copyConversationInput) { c.WrappedSecretKey = "" }), wantErr: true},
		{name: "invalid expiry", input: mutate(func(c *copyConversationInput) { c.ExpiryDuration = "1h" }), wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := validateCopyConversationInput(tc.input)
			if tc.wantErr != (err != nil) {
				t.Fatalf("validateCopyConversationInput() error = %v, wantErr = %v", err, tc.wantErr)
			}
		})
	}
}

func TestValidateCopyRedaction(t *testing.T) {
	t.Parallel()

	idMap := map[string]string{"src1": "dup1"}

	tests := []struct {
		name    string
		input   *copyRedactionInput
		wantErr bool
	}{
		{name: "nil redaction is allowed (no PII)", input: nil},
		{
			name: "valid message-anchored entry remapped to a copied id",
			input: &copyRedactionInput{
				PublicKey: validKey, WrappedSecretKey: validKey,
				Entries: []copyRedactionEntryInput{
					{Token: "[[PII_EMAIL_X]]", Data: validData, SourceKind: "message", SourceID: "dup1"},
				},
			},
		},
		{
			name: "valid with no entries (key only)",
			input: &copyRedactionInput{
				PublicKey: validKey, WrappedSecretKey: validKey,
			},
		},
		{
			name:    "missing public_key",
			input:   &copyRedactionInput{WrappedSecretKey: validKey},
			wantErr: true,
		},
		{
			name:    "missing wrapped secret",
			input:   &copyRedactionInput{PublicKey: validKey},
			wantErr: true,
		},
		{
			name: "entry missing token",
			input: &copyRedactionInput{
				PublicKey: validKey, WrappedSecretKey: validKey,
				Entries: []copyRedactionEntryInput{
					{Token: "", Data: validData, SourceKind: "message", SourceID: "dup1"},
				},
			},
			wantErr: true,
		},
		{
			name: "invalid source_kind",
			input: &copyRedactionInput{
				PublicKey: validKey, WrappedSecretKey: validKey,
				Entries: []copyRedactionEntryInput{
					{Token: "[[PII_EMAIL_X]]", Data: validData, SourceKind: "nonsense", SourceID: "dup1"},
				},
			},
			wantErr: true,
		},
		{
			name: "message entry source_id not remapped to a copied id",
			input: &copyRedactionInput{
				PublicKey: validKey, WrappedSecretKey: validKey,
				Entries: []copyRedactionEntryInput{
					// Still points at the SOURCE id — the client forgot to remap.
					{Token: "[[PII_EMAIL_X]]", Data: validData, SourceKind: "message", SourceID: "src1"},
				},
			},
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := validateCopyRedaction(tc.input, idMap)
			if tc.wantErr != (err != nil) {
				t.Fatalf("validateCopyRedaction() error = %v, wantErr = %v", err, tc.wantErr)
			}
		})
	}
}

func TestCopyMessageExpiry(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		duration string
		wantZero bool
	}{
		{name: "empty never expires", duration: "", wantZero: true},
		{name: "invalid never expires", duration: "garbage", wantZero: true},
		{name: "24h sets an expiry", duration: "24h", wantZero: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := copyMessageExpiry(tc.duration)
			if tc.wantZero != got.IsZero() {
				t.Fatalf("copyMessageExpiry(%q).IsZero() = %v, want %v", tc.duration, got.IsZero(), tc.wantZero)
			}
			if !tc.wantZero && !got.After(time.Now()) {
				t.Errorf("copyMessageExpiry(%q) = %v, want a future time", tc.duration, got)
			}
		})
	}
}
