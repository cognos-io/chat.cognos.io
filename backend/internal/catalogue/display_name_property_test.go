package catalogue

import "testing"

import "pgregory.net/rapid"

// Property: FriendlyModelName is idempotent and never grows the input. This
// pins the display-name normaliser so catalogue backfills and runtime rendering
// stay aligned.
func TestFriendlyModelNameProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		name := rapid.StringN(0, 64, 128).Draw(t, "name")
		got := FriendlyModelName(name)

		if got != FriendlyModelName(got) {
			t.Fatalf("FriendlyModelName(%q) = %q, but a second pass changed it", name, got)
		}
		if len(got) > len(name) {
			t.Fatalf("FriendlyModelName(%q) = %q, want length <= input length", name, got)
		}
	})
}
