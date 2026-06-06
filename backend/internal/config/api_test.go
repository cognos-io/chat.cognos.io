package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFileEnvValueReturnsEmptyWhenUnset(t *testing.T) {
	const envVar = "COGNOS_TEST_SECRET_FILE_UNSET"
	t.Setenv(envVar, "")

	got, err := fileEnvValue(envVar)
	if err != nil {
		t.Fatalf("fileEnvValue(%q) error = %v", envVar, err)
	}
	if got != "" {
		t.Fatalf("fileEnvValue(%q) = %q, want empty string", envVar, got)
	}
}

func TestFileEnvValueReadsTrimmedFileContents(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret")
	if err := os.WriteFile(path, []byte("test-secret\n"), 0o600); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", path, err)
	}

	const envVar = "COGNOS_TEST_SECRET_FILE_SET"
	t.Setenv(envVar, path)

	got, err := fileEnvValue(envVar)
	if err != nil {
		t.Fatalf("fileEnvValue(%q) error = %v", envVar, err)
	}
	if got != "test-secret" {
		t.Fatalf("fileEnvValue(%q) = %q, want %q", envVar, got, "test-secret")
	}
}
