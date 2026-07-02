package gateway

import "testing"

// The upstream bifrost library may log request bodies — i.e. plaintext prompts
// — at debug/info. Outside dev mode the effective level must therefore never be
// more verbose than warn, regardless of configuration.
func TestClampBifrostLogLevel(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name        string
		configured  string
		devMode     bool
		want        string
		wantClamped bool
	}{
		{name: "debug clamped to warn in production", configured: "debug", devMode: false, want: "warn", wantClamped: true},
		{name: "info clamped to warn in production", configured: "info", devMode: false, want: "warn", wantClamped: true},
		{name: "warn stays warn in production", configured: "warn", devMode: false, want: "warn", wantClamped: false},
		{name: "error stays error in production", configured: "error", devMode: false, want: "error", wantClamped: false},
		{name: "debug allowed in dev mode", configured: "debug", devMode: true, want: "debug", wantClamped: false},
		{name: "info allowed in dev mode", configured: "info", devMode: true, want: "info", wantClamped: false},
		{name: "case and whitespace normalised", configured: "  DEBUG ", devMode: false, want: "warn", wantClamped: true},
		{name: "empty falls through untouched (parser defaults to error)", configured: "", devMode: false, want: "", wantClamped: false},
		{name: "unknown falls through untouched (parser defaults to error)", configured: "verbose", devMode: false, want: "verbose", wantClamped: false},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, clamped := ClampBifrostLogLevel(tc.configured, tc.devMode)
			if got != tc.want {
				t.Errorf("ClampBifrostLogLevel(%q, dev=%v) = %q, want %q", tc.configured, tc.devMode, got, tc.want)
			}
			if clamped != tc.wantClamped {
				t.Errorf("ClampBifrostLogLevel(%q, dev=%v) clamped = %v, want %v", tc.configured, tc.devMode, clamped, tc.wantClamped)
			}
		})
	}
}
