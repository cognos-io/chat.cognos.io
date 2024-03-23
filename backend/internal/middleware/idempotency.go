package middleware

import (
	"bytes"
	"io"
	"net/http"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/idempotency"
	"github.com/labstack/echo/v5"
)

type bodyDumpResponseWriter struct {
	io.Writer
	http.ResponseWriter
}

func (w *bodyDumpResponseWriter) Write(b []byte) (int, error) {
	return w.Writer.Write(b)
}

func Idempotency(repo idempotency.IdempotencyRepo) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			// Get the user ID and idempotency key from the request and
			// if we have both, check if we have a response for this
			owner := auth.ExtractUser(c)
			idempotencyKey := c.Request().Header.Get("Idempotency-Key")

			// If we don't have a user ID or idempotency key, we can't
			// check for idempotency, so we just call the next handler.
			if owner == nil || idempotencyKey == "" {
				return next(c)
			}

			ok, statusCode, responseBodyJSON := repo.CheckForIdempotentRequest(
				owner.ID,
				idempotencyKey,
			)
			if ok {
				// If we have a response, we return it to the client.
				c.Response().WriteHeader(statusCode)
				c.Response().Write(responseBodyJSON)
				return nil
			}

			// Response
			resBody := new(bytes.Buffer)
			mw := io.MultiWriter(c.Response().Writer, resBody)
			writer := &bodyDumpResponseWriter{
				ResponseWriter: c.Response().Writer,
				Writer:         mw,
			}
			c.Response().Writer = writer

			// If we don't have a response, we call the next handler.
			if err := next(c); err != nil {
				c.Error(err)
			}

			// After the next handler has been called, we can save the
			// response and status code in the database.
			response := c.Response()
			responseBodyJSON = resBody.Bytes()
			statusCode = response.Status
			return repo.SaveIdempotentRequest(
				owner.ID,
				idempotencyKey,
				statusCode,
				responseBodyJSON,
			)
		}
	}
}
