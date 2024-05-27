package main

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/cognos-io/chat.cognos.io/backend/internal/idempotency"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/aiagent"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/compat/openai"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/proxy"
	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func rateLimiterMiddleware() echo.MiddlewareFunc {
	config := middleware.RateLimiterConfig{
		Skipper: middleware.DefaultSkipper,
		Store: middleware.NewRateLimiterMemoryStoreWithConfig(
			// Allow 1 request per second
			middleware.RateLimiterMemoryStoreConfig{
				Rate:      60.0 / 3600.0,    // 60 requests per 3600 seconds
				Burst:     30,               // Allows a portion of the requests to be used in bursts
				ExpiresIn: 30 * time.Minute, // Cleanup every 30 minutes
			},
		),
		IdentifierExtractor: func(ctx echo.Context) (string, error) {
			user := auth.ExtractUser(ctx)
			if user == nil {
				return ctx.RealIP(), nil
			}
			return user.ID, nil
		},
		ErrorHandler: func(context echo.Context, err error) error {
			return context.JSON(http.StatusForbidden, nil)
		},
		DenyHandler: func(context echo.Context, identifier string, err error) error {
			return context.JSON(http.StatusTooManyRequests, nil)
		},
	}

	return middleware.RateLimiterWithConfig(config)
}

// addPocketBaseRoutes adds additional routes to the PocketBase app.
func addPocketBaseRoutes(
	e *core.ServeEvent,
	app core.App,
	logger *slog.Logger,
	config *config.APIConfig,
	upstreamRepo proxy.UpstreamRepo,
	messageRepo chat.MessageRepo,
	keyPairRepo auth.KeyPairRepo,
	aiAgentRepo aiagent.AIAgentRepo,
	idempotencyRepo idempotency.IdempotencyRepo,
) {
	// https://platform.openai.com/docs/api-reference/chat/create
	e.Router.POST(
		"/v1/chat/completions",
		openai.EchoHandler(
			config,
			logger,
			upstreamRepo,
			messageRepo,
			keyPairRepo,
			aiAgentRepo,
		),
		apis.RequireRecordAuth(),
		rateLimiterMiddleware(),
	)
}
