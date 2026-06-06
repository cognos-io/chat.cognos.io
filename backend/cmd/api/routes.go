package main

import (
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/cognos-io/chat.cognos.io/backend/internal/handler"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/aiagent"
	compatopenai "github.com/cognos-io/chat.cognos.io/backend/pkg/compat/openai"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/proxy"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"golang.org/x/time/rate"
)

type rateLimiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

var routeRateLimiters = struct {
	mu      sync.Mutex
	entries map[string]*rateLimiterEntry
}{
	entries: map[string]*rateLimiterEntry{},
}

func rateLimiterMiddleware() *hook.Handler[*core.RequestEvent] {
	const (
		requestsPerHour = 60.0
		burst           = 30
		expiresIn       = 30 * time.Minute
	)

	return &hook.Handler[*core.RequestEvent]{
		Func: func(e *core.RequestEvent) error {
			identifier := e.RealIP()
			if user := auth.ExtractUser(e); user != nil {
				identifier = user.ID
			}

			now := time.Now()

			routeRateLimiters.mu.Lock()
			for key, entry := range routeRateLimiters.entries {
				if now.Sub(entry.lastSeen) > expiresIn {
					delete(routeRateLimiters.entries, key)
				}
			}

			entry, ok := routeRateLimiters.entries[identifier]
			if !ok {
				entry = &rateLimiterEntry{
					limiter: rate.NewLimiter(rate.Limit(requestsPerHour/3600.0), burst),
				}
				routeRateLimiters.entries[identifier] = entry
			}
			entry.lastSeen = now
			allowed := entry.limiter.Allow()
			routeRateLimiters.mu.Unlock()

			if !allowed {
				return e.JSON(http.StatusTooManyRequests, nil)
			}

			return e.Next()
		},
	}
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
	conversationRepo chat.ConversationRepo,
	billingService *billing.Service,
) {
	e.Router.GET(
		"/api/v1/models",
		handler.ModelsGet(),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(),
	)

	e.Router.GET(
		"/api/v1/conversations",
		handler.ConversationsList(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(),
	)

	e.Router.POST(
		"/api/v1/conversations",
		handler.ConversationsCreate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(),
	)

	e.Router.PATCH(
		"/api/v1/conversations/{conversationID}",
		handler.ConversationsUpdate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(),
	)

	e.Router.DELETE(
		"/api/v1/conversations/{conversationID}",
		handler.ConversationsDelete(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(),
	)

	e.Router.GET(
		"/api/v1/conversations/{conversationID}/messages",
		handler.ConversationMessagesList(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(),
	)

	e.Router.PATCH(
		"/api/v1/messages/{messageID}",
		handler.MessagesUpdate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(),
	)

	e.Router.DELETE(
		"/api/v1/messages/{messageID}",
		handler.MessagesDelete(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(),
	)

	completeParams := handler.CompleteHandlerParams{
		Logger:           logger,
		UpstreamRepo:     upstreamRepo,
		MessageRepo:      messageRepo,
		ConversationRepo: conversationRepo,
		AgentRepo:        aiAgentRepo,
		BillingService:   billingService,
	}

	e.Router.POST(
		"/api/v1/completions",
		handler.Complete(completeParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(),
	)

	e.Router.POST(
		"/api/v1/conversations/{conversationID}/complete",
		handler.CompleteConversation(completeParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(),
	)

	e.Router.POST(
		"/v1/chat/completions",
		compatopenai.Handler(
			config,
			logger,
			upstreamRepo,
			messageRepo,
			keyPairRepo,
			aiAgentRepo,
			conversationRepo,
		),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(),
	)

	e.Router.GET(
		"/health",
		func(re *core.RequestEvent) error {
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

			if _, err := app.CountRecords("users"); err != nil {
				status = http.StatusInternalServerError
			} else {
				resp.IsDatabaseConnected = true
			}

			host := "www.example.com"

			if _, err := net.LookupHost(host); err != nil {
				status = http.StatusInternalServerError
			} else {
				resp.Network.CanResolveDNS = true
			}

			conn, err := net.DialTimeout("tcp", host+":80", 2*time.Second)
			if err != nil {
				status = http.StatusInternalServerError
			} else {
				resp.Network.CanPing = true
				defer conn.Close()
			}

			if _, err := http.Get(fmt.Sprintf("https://%s", host)); err != nil {
				status = http.StatusInternalServerError
			} else {
				resp.Network.CanConnectOverInternet = true
			}

			return re.JSON(status, resp)
		},
	).Bind(rateLimiterMiddleware())

	registry := prometheus.NewRegistry()
	registry.MustRegister(
		prometheus.NewProcessCollector(prometheus.ProcessCollectorOpts{}),
		prometheus.NewGoCollector(),
	)

	registerPrometheusGauge(registry, app, logger, "users", "Number of users in the system")
	registerPrometheusGauge(
		registry,
		app,
		logger,
		"conversations",
		"Number of conversations in the system",
	)
	registerPrometheusGauge(
		registry,
		app,
		logger,
		"messages",
		"Number of messages in the system",
	)
	registerPrometheusGauge(
		registry,
		app,
		logger,
		"agents",
		"Number of agents in the system",
	)

	e.Router.GET(
		"/metrics",
		apis.WrapStdHandler(promhttp.HandlerFor(registry, promhttp.HandlerOpts{})),
	)
}

func registerPrometheusGauge(
	registry *prometheus.Registry,
	app core.App,
	logger *slog.Logger,
	name string,
	help string,
) {
	_ = promauto.With(registry).NewGaugeFunc(prometheus.GaugeOpts{
		Namespace: "cognos",
		Subsystem: "chat",
		Name:      name,
		Help:      help,
	}, func() float64 {
		totalCount, err := app.CountRecords(name)
		if err != nil {
			logger.Error("failed to get count", "err", err)
			return -1
		}

		return float64(totalCount)
	})
}
