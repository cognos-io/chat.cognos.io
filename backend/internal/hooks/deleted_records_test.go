package hooks

import "testing"

func TestShouldCopyDeletedRecord(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		collectionName string
		want           bool
	}{
		{name: "deleted collection", collectionName: "deleted", want: false},
		{name: "user key pairs", collectionName: "user_key_pairs", want: false},
		{name: "conversation public keys", collectionName: "conversation_public_keys", want: false},
		{name: "conversation secret keys", collectionName: "conversation_secret_keys", want: false},
		// Library files hold per-file keys in their sealed manifest, so removal
		// must erase immediately rather than linger in the retention snapshot.
		{name: "user attachments", collectionName: "user_attachments", want: false},
		// The usage join is plaintext routing only — still soft-deleted for audit.
		{name: "attachment usages", collectionName: "attachment_usages", want: true},
		{name: "ordinary collection", collectionName: "user_preferences", want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := ShouldCopyDeletedRecord(tt.collectionName); got != tt.want {
				t.Fatalf("ShouldCopyDeletedRecord(%q) = %v, want %v", tt.collectionName, got, tt.want)
			}
		})
	}
}
