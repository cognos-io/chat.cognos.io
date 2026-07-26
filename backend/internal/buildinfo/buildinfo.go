// Package buildinfo exposes the git commit baked into the API binary.
//
// Release builds set Commit via -ldflags (see container/backend/Containerfile).
// Local builds without ldflags fall back to the Go toolchain's VCS metadata
// (available when the module is built from a git checkout with -buildvcs).
package buildinfo

import (
	"runtime/debug"
	"sync"
)

// CommitHeader is the HTTP response header that carries the API commit SHA.
const CommitHeader = "X-Cognos-Commit"

// Commit is set at link time:
//
//	-X github.com/cognos-io/chat.cognos.io/backend/internal/buildinfo.Commit=<sha>
//
// Empty means ResolvedCommit falls back to VCS build info, then "unknown".
var Commit string

var (
	vcsOnce sync.Once
	vcs     string
)

// ResolvedCommit returns the baked-in git commit SHA, or "unknown" when none
// is available. Safe for concurrent use. The ldflags Commit value is always
// preferred when set so tests and release builds can override without resetting
// package state.
func ResolvedCommit() string {
	if Commit != "" {
		return Commit
	}
	return vcsCommit()
}

func vcsCommit() string {
	vcsOnce.Do(func() {
		if info, ok := debug.ReadBuildInfo(); ok {
			for _, setting := range info.Settings {
				if setting.Key == "vcs.revision" && setting.Value != "" {
					vcs = setting.Value
					return
				}
			}
		}
		vcs = "unknown"
	})
	return vcs
}
