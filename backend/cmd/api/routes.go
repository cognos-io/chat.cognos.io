package main

import (
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/analytics"
	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
	"github.com/cognos-io/chat.cognos.io/backend/internal/handler"
	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
	"github.com/cognos-io/chat.cognos.io/backend/internal/participants"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/aiagent"
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

// resetRouteRateLimiters clears the in-process rate-limit state. Tests call
// this from setupTestApp so the per-binary accumulator doesn't trip
// previously-irrelevant tests once the suite grows past the burst budget.
// Production code never invokes this — the limiter relies on the natural
// expiry-based cleanup inside the middleware.
func resetRouteRateLimiters() {
	routeRateLimiters.mu.Lock()
	routeRateLimiters.entries = map[string]*rateLimiterEntry{}
	routeRateLimiters.mu.Unlock()
}

func rateLimiterMiddleware(app core.App) *hook.Handler[*core.RequestEvent] {
	// Order-of-magnitude budget for an active chat session: ~10 requests/min
	// average with a generous burst for opening the app (which fires several
	// /api/v1/* GETs in parallel on first paint).
	const (
		requestsPerHour = 600.0
		burst           = 60
		expiresIn       = 30 * time.Minute
	)

	devMode := app.IsDev()

	return &hook.Handler[*core.RequestEvent]{
		Func: func(e *core.RequestEvent) error {
			if devMode {
				return e.Next()
			}

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
	catalogueService catalogue.Service,
	gatewayClient gateway.Client,
	messageRepo chat.MessageRepo,
	aiAgentRepo aiagent.AIAgentRepo,
	conversationRepo chat.ConversationRepo,
	billingService *billing.Service,
	billingStateRepo billing.StateRepo,
	billingLedgerRepo billing.LedgerRepo,
	billingTransactionsRepo billing.TransactionsRepo,
	fxRateProvider billing.FXRateProvider,
	usageEmitter analytics.Emitter,
	completeBillingGate handler.CompleteBillingGateFunc,
	paddleClient paddle.Client,
	paddlePrices map[string]string,
) {
	e.Router.GET(
		"/api/v1/models",
		handler.ModelsGet(catalogueService),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/billing",
		handler.BillingGet(handler.BillingGetParams{
			Logger:    logger,
			StateRepo: billingStateRepo,
		}),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/billing/transactions",
		handler.BillingTransactions(handler.BillingTransactionsParams{
			Logger:           logger,
			TransactionsRepo: billingTransactionsRepo,
		}),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/billing/checkout",
		handler.BillingCheckout(handler.BillingCheckoutParams{
			Logger: logger,
			Client: paddleClient,
			Prices: paddlePrices,
		}),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/conversations",
		handler.ConversationsList(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/conversations",
		handler.ConversationsCreate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.PATCH(
		"/api/v1/conversations/{conversationID}",
		handler.ConversationsUpdate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.DELETE(
		"/api/v1/conversations/{conversationID}",
		handler.ConversationsDelete(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/conversations/{conversationID}/messages",
		handler.ConversationMessagesList(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/conversations/{conversationID}/participants",
		handler.ConversationParticipantsList(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/conversations/{conversationID}/participants",
		handler.ConversationParticipantsAdd(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/conversations/{conversationID}/rotate",
		handler.ConversationKeyRotate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/conversations/{conversationID}/public-share",
		handler.ConversationPublicShareGet(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/conversations/{conversationID}/public-share",
		handler.ConversationPublicShareCreate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.DELETE(
		"/api/v1/conversations/{conversationID}/public-share",
		handler.ConversationPublicShareDelete(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	// Public, unauthenticated read surface for shared conversations. Gated by
	// the existence of a share row for the token, NOT by auth — the URL
	// fragment (held only by the client) is what decrypts the payload. Rate
	// limited by IP since there's no user to key on.
	e.Router.GET(
		"/api/v1/public/conversations/{token}",
		handler.PublicConversationGet(app),
	).Bind(
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/public/conversations/{token}/messages",
		handler.PublicConversationMessagesList(app),
	).Bind(
		rateLimiterMiddleware(app),
	)

	e.Router.PATCH(
		"/api/v1/messages/{messageID}",
		handler.MessagesUpdate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.DELETE(
		"/api/v1/messages/{messageID}",
		handler.MessagesDelete(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	completeParams := handler.CompleteHandlerParams{
		Logger:              logger,
		CatalogueService:    catalogueService,
		GatewayClient:       gatewayClient,
		MessageRepo:         messageRepo,
		ConversationRepo:    conversationRepo,
		AgentRepo:           aiAgentRepo,
		BillingService:      billingService,
		BillingStateRepo:    billingStateRepo,
		BillingLedgerRepo:   billingLedgerRepo,
		FXRateProvider:      fxRateProvider,
		UsageEmitter:        usageEmitter,
		CompleteBillingGate: completeBillingGate,
		ParticipantsRepo:    participants.NewPocketBaseRepo(app),
	}

	e.Router.GET(
		"/api/v1/user-key-pair",
		handler.UserKeyPairGet(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/user-key-pair",
		handler.UserKeyPairCreate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.PATCH(
		"/api/v1/user-key-pair/{keyPairID}",
		handler.UserKeyPairUpdate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/conversations/{conversationID}/public-key",
		handler.ConversationPublicKeyGet(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/conversations/{conversationID}/public-key",
		handler.ConversationPublicKeyCreate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.PATCH(
		"/api/v1/conversations/{conversationID}/public-key/{publicKeyID}",
		handler.ConversationPublicKeyUpdate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/conversations/{conversationID}/secret-key",
		handler.ConversationSecretKeyGet(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/conversations/{conversationID}/secret-key",
		handler.ConversationSecretKeyCreate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/user-preferences",
		handler.UserPreferencesGet(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/user-preferences",
		handler.UserPreferencesCreate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.PATCH(
		"/api/v1/user-preferences/{preferencesID}",
		handler.UserPreferencesUpdate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/vault-session",
		handler.VaultSessionGet(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.PUT(
		"/api/v1/vault-session",
		handler.VaultSessionUpsert(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.DELETE(
		"/api/v1/vault-session",
		handler.VaultSessionDelete(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/completions",
		handler.Complete(completeParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/conversations/{conversationID}/complete",
		handler.CompleteConversation(completeParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/conversations/{conversationID}/regenerate",
		handler.RegenerateConversation(completeParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST("/v1/auth/logout", func(re *core.RequestEvent) error {
		re.Auth.RefreshTokenKey()
		if err := app.Save(re.Auth); err != nil {
			return err
		}

		if record, err := app.FindFirstRecordByData("vault_session_wrap_keys", "user", re.Auth.Id); err == nil {
			if err := app.Delete(record); err != nil {
				logger.Warn("failed to clear vault session on logout", "err", err)
			}
		}

		return re.NoContent(http.StatusNoContent)
	}).Bind(
		apis.RequireAuth(),
	)

	e.Router.GET(
		"/health",
		func(re *core.RequestEvent) error {
			type HealthResponse struct {
				IsDatabaseConnected bool `json:"is_database_connected"`
			}

			resp := HealthResponse{}
			status := http.StatusOK

			if _, err := app.CountRecords("users"); err != nil {
				status = http.StatusInternalServerError
			} else {
				resp.IsDatabaseConnected = true
			}

			return re.JSON(status, resp)
		},
	).Bind(rateLimiterMiddleware(app))

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
	).Bind(
		apis.RequireAuth(),
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
