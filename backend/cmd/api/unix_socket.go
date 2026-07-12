package main

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"

	"github.com/pocketbase/pocketbase/core"
)

const defaultUnixSocketMode = os.FileMode(0o660)

type unixSocketConfig struct {
	path string
	mode os.FileMode
}

func loadUnixSocketConfig(getenv func(string) string) (unixSocketConfig, bool, error) {
	path := getenv("COGNOS_BACKEND_UNIX_SOCKET")
	if path == "" {
		return unixSocketConfig{}, false, nil
	}

	mode := defaultUnixSocketMode
	if rawMode := getenv("COGNOS_BACKEND_UNIX_SOCKET_MODE"); rawMode != "" {
		parsedMode, err := strconv.ParseUint(rawMode, 8, 32)
		if err != nil || parsedMode > 0o777 {
			return unixSocketConfig{}, false, fmt.Errorf(
				"COGNOS_BACKEND_UNIX_SOCKET_MODE must be an octal permission mode between 000 and 777: %q",
				rawMode,
			)
		}
		mode = os.FileMode(parsedMode)
	}

	return unixSocketConfig{path: path, mode: mode}, true, nil
}

func bindUnixSocket(app core.App, config unixSocketConfig) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		listener, err := listenUnixSocket(config)
		if err != nil {
			return err
		}

		e.Listener = listener
		if err := e.Next(); err != nil {
			_ = listener.Close()
			return err
		}

		return nil
	})
}

func listenUnixSocket(config unixSocketConfig) (net.Listener, error) {
	// #nosec G301 -- the reverse proxy must be able to traverse the socket directory.
	if err := os.MkdirAll(filepath.Dir(config.path), 0o755); err != nil {
		return nil, fmt.Errorf("create Unix socket directory: %w", err)
	}

	info, err := os.Lstat(config.path)
	if err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return nil, fmt.Errorf("unix socket path %q exists and is not a socket", config.path)
		}
		if err := os.Remove(config.path); err != nil {
			return nil, fmt.Errorf("remove stale Unix socket: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("inspect Unix socket path: %w", err)
	}

	listener, err := net.Listen("unix", config.path)
	if err != nil {
		return nil, fmt.Errorf("listen on Unix socket: %w", err)
	}
	if err := os.Chmod(config.path, config.mode); err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("set Unix socket permissions: %w", err)
	}

	return listener, nil
}
