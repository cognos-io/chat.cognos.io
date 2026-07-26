package buildinfo

import "testing"

func TestResolvedCommitUsesLdflagsOverride(t *testing.T) {
	t.Parallel()

	// Pin: when Commit is set (release/container builds), ResolvedCommit must
	// return that exact value and never fall through to VCS/"unknown".
	prev := Commit
	t.Cleanup(func() { Commit = prev })

	Commit = "abc123deadbeef"
	got := ResolvedCommit()
	if got != "abc123deadbeef" {
		t.Errorf("ResolvedCommit() = %q, want %q", got, "abc123deadbeef")
	}
}

func TestResolvedCommitFallsBackWhenUnset(t *testing.T) {
	t.Parallel()

	prev := Commit
	t.Cleanup(func() { Commit = prev })

	Commit = ""
	got := ResolvedCommit()
	if got == "" {
		t.Errorf("ResolvedCommit() = %q, want non-empty (vcs revision or unknown)", got)
	}
}
