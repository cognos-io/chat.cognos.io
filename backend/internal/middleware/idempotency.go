package middleware

import (
	"bytes"
	"io"
	"net/http"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/idempotency"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/router"
)

type bodyDumpResponseWriter struct {
	io.Writer
	http.ResponseWriter
}

func (w *bodyDumpResponseWriter) Write(b []byte) (int, error) {
	return w.Writer.Write(b)
}

func Idempotency(repo idempotency.IdempotencyRepo) *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Func: func(e *core.RequestEvent) error {
			owner := auth.ExtractUser(e)
			idempotencyKey := e.Request.Header.Get("Idempotency-Key")
			if owner == nil || idempotencyKey == "" {
				return e.Next()
			}

			ok, statusCode, responseBodyJSON := repo.CheckForIdempotentRequest(
				owner.ID,
				idempotencyKey,
			)
			if ok {
				e.Response.WriteHeader(statusCode)
				_, err := e.Response.Write(responseBodyJSON)
				return err
			}

			resBody := new(bytes.Buffer)
			mw := io.MultiWriter(e.Response, resBody)
			writer := &bodyDumpResponseWriter{
				ResponseWriter: e.Response,
				Writer:         mw,
			}
			e.Response = writer

			if err := e.Next(); err != nil {
				return err
			}

			responseBodyJSON = resBody.Bytes()
			statusCode = http.StatusOK
			if tracker, ok := e.Response.(router.StatusTracker); ok && tracker.Status() > 0 {
				statusCode = tracker.Status()
			}

			return repo.SaveIdempotentRequest(
				owner.ID,
				idempotencyKey,
				statusCode,
				responseBodyJSON,
			)
		},
	}
}
