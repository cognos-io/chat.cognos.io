package openai

import "testing"

func TestUpstreamUserID(t *testing.T) {
	t.Parallel()

	const userID = "pb_user_123"

	got := upstreamUserID(userID)
	if got == userID {
		t.Fatalf("upstreamUserID(%q) leaked raw user id", userID)
	}
	if len(got) != 16 {
		t.Fatalf("len(upstreamUserID(%q)) = %d, want 16", userID, len(got))
	}

	gotAgain := upstreamUserID(userID)
	if gotAgain != got {
		t.Fatalf("upstreamUserID(%q) = %q on second call, want %q", userID, gotAgain, got)
	}

	other := upstreamUserID("pb_user_456")
	if other == got {
		t.Fatalf("upstreamUserID() collision: %q", got)
	}
}
