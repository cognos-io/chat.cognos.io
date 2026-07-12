package main

import (
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

func TestLoadUnixSocketConfig(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		env       map[string]string
		want      unixSocketConfig
		wantSet   bool
		wantError bool
	}{
		{
			name: "not configured",
		},
		{
			name: "default mode",
			env: map[string]string{
				"COGNOS_BACKEND_UNIX_SOCKET": "/run/cognos/api.sock",
			},
			want:    unixSocketConfig{path: "/run/cognos/api.sock", mode: 0o660},
			wantSet: true,
		},
		{
			name: "configured mode",
			env: map[string]string{
				"COGNOS_BACKEND_UNIX_SOCKET":      "/run/cognos/api.sock",
				"COGNOS_BACKEND_UNIX_SOCKET_MODE": "600",
			},
			want:    unixSocketConfig{path: "/run/cognos/api.sock", mode: 0o600},
			wantSet: true,
		},
		{
			name: "invalid mode",
			env: map[string]string{
				"COGNOS_BACKEND_UNIX_SOCKET":      "/run/cognos/api.sock",
				"COGNOS_BACKEND_UNIX_SOCKET_MODE": "not-octal",
			},
			wantError: true,
		},
		{
			name: "mode outside permission bits",
			env: map[string]string{
				"COGNOS_BACKEND_UNIX_SOCKET":      "/run/cognos/api.sock",
				"COGNOS_BACKEND_UNIX_SOCKET_MODE": "1660",
			},
			wantError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			getenv := func(key string) string { return tt.env[key] }
			got, gotSet, err := loadUnixSocketConfig(getenv)
			if gotError := err != nil; gotError != tt.wantError {
				t.Errorf("loadUnixSocketConfig(%v) error = %v, want error presence = %t", tt.env, err, tt.wantError)
			}
			if gotSet != tt.wantSet {
				t.Errorf("loadUnixSocketConfig(%v) configured = %t, want %t", tt.env, gotSet, tt.wantSet)
			}
			if got != tt.want {
				t.Errorf("loadUnixSocketConfig(%v) = %+v, want %+v", tt.env, got, tt.want)
			}
		})
	}
}

func TestListenUnixSocketCreatesSocketWithConfiguredMode(t *testing.T) {
	t.Parallel()

	dir, err := os.MkdirTemp("/tmp", "cognos-socket-test-")
	if err != nil {
		t.Fatalf("os.MkdirTemp(): %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	path := filepath.Join(dir, "nested", "api.sock")
	listener, err := listenUnixSocket(unixSocketConfig{path: path, mode: 0o620})
	if err != nil {
		t.Fatalf("listenUnixSocket(%q, %o): %v", path, 0o620, err)
	}
	t.Cleanup(func() { _ = listener.Close() })

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("os.Stat(%q): %v", path, err)
	}
	if info.Mode()&os.ModeSocket == 0 {
		t.Errorf("listenUnixSocket(%q, %o) mode = %v, want Unix socket", path, 0o620, info.Mode())
	}
	if got := info.Mode().Perm(); got != 0o620 {
		t.Errorf("listenUnixSocket(%q, %o) permissions = %o, want %o", path, 0o620, got, 0o620)
	}

	client, err := net.Dial("unix", path)
	if err != nil {
		t.Errorf("net.Dial(unix, %q): %v", path, err)
	} else {
		_ = client.Close()
	}
}

func TestBindUnixSocketSetsPocketBaseServeListener(t *testing.T) {
	t.Parallel()

	dir, err := os.MkdirTemp("/tmp", "cognos-socket-test-")
	if err != nil {
		t.Fatalf("os.MkdirTemp(): %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	path := filepath.Join(dir, "api.sock")

	app := NewServer()
	bindUnixSocket(app, unixSocketConfig{path: path, mode: 0o660})
	event := &core.ServeEvent{Server: &http.Server{}}
	if err := app.OnServe().Trigger(event, func(e *core.ServeEvent) error {
		if e.Listener == nil {
			t.Errorf("bindUnixSocket(%q) ServeEvent.Listener = nil, want Unix listener", path)
			return nil
		}
		t.Cleanup(func() { _ = e.Listener.Close() })
		if got, want := e.Listener.Addr().Network(), "unix"; got != want {
			t.Errorf("bindUnixSocket(%q) listener network = %q, want %q", path, got, want)
		}
		return nil
	}); err != nil {
		t.Fatalf("bindUnixSocket(%q) OnServe trigger: %v", path, err)
	}
}

func TestListenUnixSocketReplacesStaleSocket(t *testing.T) {
	t.Parallel()

	dir, err := os.MkdirTemp("/tmp", "cognos-socket-test-")
	if err != nil {
		t.Fatalf("os.MkdirTemp(): %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	path := filepath.Join(dir, "api.sock")
	stale, err := net.Listen("unix", path)
	if err != nil {
		t.Fatalf("net.Listen(unix, %q): %v", path, err)
	}
	if unixListener, ok := stale.(*net.UnixListener); ok {
		unixListener.SetUnlinkOnClose(false)
	}
	if err := stale.Close(); err != nil {
		t.Fatalf("close stale listener at %q: %v", path, err)
	}

	listener, err := listenUnixSocket(unixSocketConfig{path: path, mode: 0o660})
	if err != nil {
		t.Fatalf("listenUnixSocket(%q, %o) with stale socket: %v", path, 0o660, err)
	}
	t.Cleanup(func() { _ = listener.Close() })
}

func TestListenUnixSocketDoesNotRemoveRegularFile(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "api.sock")
	if err := os.WriteFile(path, []byte("keep me"), 0o600); err != nil {
		t.Fatalf("os.WriteFile(%q): %v", path, err)
	}

	listener, err := listenUnixSocket(unixSocketConfig{path: path, mode: 0o660})
	if listener != nil {
		_ = listener.Close()
	}
	if err == nil {
		t.Errorf("listenUnixSocket(%q, %o) error = nil, want error for regular file", path, 0o660)
	}
	contents, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatalf("os.ReadFile(%q): %v", path, readErr)
	}
	if got, want := string(contents), "keep me"; got != want {
		t.Errorf("os.ReadFile(%q) = %q, want %q", path, got, want)
	}
}
