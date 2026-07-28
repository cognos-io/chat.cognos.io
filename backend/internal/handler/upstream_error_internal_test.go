package handler

import (
	"errors"
	"net/http"
	"testing"
)

// The cause of an upstream failure has to reach the operator (PocketBase logs
// the raw error data as `data.details` on the request log entry) without ever
// reaching the caller. These tests pin both halves of that contract.
func TestUpstreamError(t *testing.T) {
	t.Parallel()

	cause := errors.New("paddle transactions returned 403: {\"error\":{\"code\":\"forbidden\"}}")

	t.Run("carries the cause as raw error data", func(t *testing.T) {
		t.Parallel()

		apiErr := upstreamError("Failed to start checkout", cause)

		if apiErr.Status != http.StatusBadGateway {
			t.Fatalf("status = %d, want %d", apiErr.Status, http.StatusBadGateway)
		}
		if !errors.Is(apiErr, cause) {
			t.Fatalf("RawData() = %v, want the wrapped cause", apiErr.RawData())
		}
	})

	t.Run("keeps the cause out of the client response", func(t *testing.T) {
		t.Parallel()

		apiErr := upstreamError("Failed to start checkout", cause)

		if apiErr.Message != "Failed to start checkout." {
			t.Fatalf("message = %q, want the sentenized public message", apiErr.Message)
		}
		// Data is the only part of rawData that gets serialized to the caller;
		// PocketBase only fills it for validation errors, so a plain upstream
		// error must serialize to an empty object.
		if len(apiErr.Data) != 0 {
			t.Fatalf("client-visible Data = %v, want empty", apiErr.Data)
		}
	})

	t.Run("falls back to the message when there is no cause", func(t *testing.T) {
		t.Parallel()

		apiErr := upstreamError("Failed to start checkout", nil)

		if apiErr.RawData() != nil {
			t.Fatalf("RawData() = %v, want nil", apiErr.RawData())
		}
		if apiErr.Status != http.StatusBadGateway {
			t.Fatalf("status = %d, want %d", apiErr.Status, http.StatusBadGateway)
		}
	})
}
