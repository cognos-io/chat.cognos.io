package main

import (
	"fmt"
	"log/slog"
	"net"
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
	"github.com/pocketbase/pocketbase/models"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
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

	e.Router.GET(
		"/health",
		func(ctx echo.Context) error {
			type HealthResponse struct {
				IsDatabaseConnected bool `json:"is_database_connected"`
				Network             struct {
					CanPing                bool `json:"can_ping"`
					CanResolveDNS          bool `json:"can_resolve_dns"`
					CanConnectOverInternet bool `json:"can_connect_over_internet"`
				} `json:"network"`
			}

			resp := HealthResponse{}
			status := http.StatusOK

			// Database check
			// Discussion here about how to approach this:
			// https://github.com/pocketbase/pocketbase/discussions/5035
			query := app.Dao().RecordQuery("users").Select("id").Limit(1)
			records := []*models.Record{}
			if err := query.All(&records); err != nil {
				status = http.StatusInternalServerError
			} else {
				resp.IsDatabaseConnected = true
			}

			// Network checks
			host := "www.example.com"

			_, err := net.LookupHost(host)
			if err != nil {
				status = http.StatusInternalServerError
			} else {
				resp.Network.CanResolveDNS = true
			}

			conn, err := net.DialTimeout("tcp", host+":80", 2*time.Second)
			if err != nil {
				status = http.StatusInternalServerError
			} else {
				resp.Network.CanPing = true
			}
			defer conn.Close()

			_, err = http.Get(fmt.Sprintf("https://%s", host))
			if err != nil {
				status = http.StatusInternalServerError
			} else {
				resp.Network.CanConnectOverInternet = true
			}

			return ctx.JSON(status, resp)
		},
		rateLimiterMiddleware(),
	)

	// Prometheus metrics endpoint for Grafana Alloy
	registerPrometheusGauge(app, logger, "users", "Number of users in the system")
	registerPrometheusGauge(
		app,
		logger,
		"conversations",
		"Number of conversations in the system",
	)
	registerPrometheusGauge(
		app,
		logger,
		"messages",
		"Number of messages in the system",
	)
	registerPrometheusGauge(app, logger, "agents", "Number of agents in the system")

	e.Router.GET("/metrics", echo.WrapHandler(promhttp.Handler()))
}

func registerPrometheusGauge(
	app core.App,
	logger *slog.Logger,
	name string,
	help string,
) {
	_ = promauto.NewGaugeFunc(prometheus.GaugeOpts{
		Namespace: "cognos",
		Subsystem: "chat",
		Name:      name,
		Help:      help,
	}, func() float64 {
		// negative value to differentiate from the zero default
		totalCount := -1

		err := app.Dao().
			RecordQuery(name).
			Distinct(false).
			Select("COUNT(id)").
			OrderBy().Row(&totalCount)
		if err != nil {
			logger.Error("failed to get count", "err", err)
		}

		return float64(totalCount)
	})
}
