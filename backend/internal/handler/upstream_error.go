package handler

import (
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/tools/router"
)

// upstreamError builds the 502 we return when a third-party call (Paddle, a
// model gateway) fails. The cause travels as the ApiError's raw error data,
// which PocketBase records as `data.details` on the request log entry so an
// operator sees the actual failure next to the status and URL. The caller only
// ever receives `message` plus an empty `data` object: PocketBase serializes
// raw error data for validation errors only, so an upstream error can't leak
// provider internals to the browser.
//
// Handlers should still log their own line for extra context (plan, org id),
// but the request log alone is now enough to tell two 502s apart.
func upstreamError(message string, err error) *router.ApiError {
	return apis.NewApiError(http.StatusBadGateway, message, err)
}
