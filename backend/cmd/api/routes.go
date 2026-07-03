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
	"github.com/cognos-io/chat.cognos.io/backend/internal/compaction"
	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
	"github.com/cognos-io/chat.cognos.io/backend/internal/handler"
	"github.com/cognos-io/chat.cognos.io/backend/internal/mfa"
	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
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
	conversationRepo chat.ConversationRepo,
	billingService *billing.Service,
	billingStateRepo billing.StateRepo,
	billingLedgerRepo billing.LedgerRepo,
	billingTransactionsRepo billing.TransactionsRepo,
	fxRateProvider billing.FXRateProvider,
	usageEmitter analytics.Emitter,
	completeBillingGate handler.CompleteBillingGateFunc,
	completionStopper *handler.CompletionStopper,
	paddleClient paddle.Client,
	paddlePrices map[string]string,
	paddleWebhookSecret string,
	paddlePriceToPlan map[string]billing.PlanType,
	billingUsageRepo billing.UsageRepo,
	paddlePlanByPrice map[string]handler.PlanMeta,
	paddleMinCommitRappen int64,
	paddleOveragePriceID string,
	attachmentMaxFileBytes int64,
	attachmentStorageCapBytes int64,
	mfaCipher *mfa.SeedCipher,
) {
	// Shared MFA dependencies for the auth-completion and management endpoints.
	mfaStore := mfa.NewStore(app)
	mfaIssuer := app.Settings().Meta.AppName
	if mfaIssuer == "" {
		mfaIssuer = "Cognos"
	}
	mfaParams := handler.MFAParams{
		App:    app,
		Store:  mfaStore,
		Cipher: mfaCipher,
		Issuer: mfaIssuer,
		Logger: logger,
	}
	// Paddle webhook: unauthenticated (verified by HMAC) and unthrottled so we
	// never drop Paddle's retries. Bad signatures are rejected before any write.
	e.Router.POST(
		"/webhooks/paddle",
		handler.PaddleWebhook(handler.PaddleWebhookParams{
			Logger:          logger,
			WebhookSecret:   paddleWebhookSecret,
			PriceToPlan:     paddlePriceToPlan,
			MinCommitRappen: paddleMinCommitRappen,
			Client:          paddleClient,
			OveragePriceID:  paddleOveragePriceID,
			Reconciler:      billing.NewPocketBaseRepo(app),
		}),
	)

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
			Logger:          logger,
			StateRepo:       billingStateRepo,
			PlanByPrice:     paddlePlanByPrice,
			MinCommitRappen: paddleMinCommitRappen,
		}),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/billing/usage",
		handler.BillingUsage(handler.BillingUsageParams{
			Logger:    logger,
			StateRepo: billingStateRepo,
			UsageRepo: billingUsageRepo,
		}),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/billing/cancel",
		handler.BillingCancel(handler.BillingSubscriptionParams{
			Logger: logger,
			Client: paddleClient,
		}),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/billing/resume",
		handler.BillingResume(handler.BillingSubscriptionParams{
			Logger: logger,
			Client: paddleClient,
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

	e.Router.POST(
		"/api/v1/billing/change-plan",
		handler.BillingChangePlan(handler.BillingChangePlanParams{
			Logger:          logger,
			Client:          paddleClient,
			Prices:          paddlePrices,
			OveragePriceID:  paddleOveragePriceID,
			MinCommitRappen: paddleMinCommitRappen,
		}),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/billing/refund-request",
		handler.BillingRefundRequest(handler.BillingRefundRequestParams{
			Logger: logger,
		}),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/billing/portal",
		handler.BillingPortal(handler.BillingPortalParams{
			Logger: logger,
			Client: paddleClient,
		}),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/billing/invoices",
		handler.BillingInvoices(handler.BillingInvoicesParams{
			Logger: logger,
			Client: paddleClient,
		}),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/billing/invoices/{id}/pdf",
		handler.BillingInvoicePDF(handler.BillingInvoicePDFParams{
			Logger: logger,
			Client: paddleClient,
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

	e.Router.POST(
		"/api/v1/conversations/{conversationID}/copies",
		handler.ConversationCopy(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.DELETE(
		"/api/v1/conversations",
		handler.ConversationsDeleteAll(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.DELETE(
		"/api/v1/account",
		handler.AccountDelete(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	// MFA login completion. Unauthenticated by design: the caller holds an
	// mfaSessionId (proof the password factor passed), not a token yet. Rate
	// limited by IP; brute-force is further bounded by the per-session burn and
	// per-account cooldown enforced inside the handlers.
	e.Router.POST(
		"/api/v1/auth/mfa/totp",
		handler.MFACompleteTOTP(mfaParams),
	).Bind(
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/auth/mfa/recovery",
		handler.MFACompleteRecovery(mfaParams),
	).Bind(
		rateLimiterMiddleware(app),
	)

	// MFA management (authenticated): enrolment, disablement, recovery-code
	// regeneration, and trusted-device administration.
	e.Router.GET("/api/v1/mfa", handler.MFAStatus(mfaParams)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))
	e.Router.POST("/api/v1/mfa/totp/enrol", handler.MFAEnrolTOTP(mfaParams)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))
	e.Router.POST("/api/v1/mfa/totp/confirm", handler.MFAConfirmTOTP(mfaParams)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))
	e.Router.POST("/api/v1/mfa/totp/disable", handler.MFADisableTOTP(mfaParams)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))
	e.Router.POST("/api/v1/mfa/recovery-codes", handler.MFARegenerateRecoveryCodes(mfaParams)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))
	e.Router.GET("/api/v1/mfa/trusted-devices", handler.MFAListTrustedDevices(mfaParams)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))
	e.Router.DELETE("/api/v1/mfa/trusted-devices/{id}", handler.MFARevokeTrustedDevice(mfaParams)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))

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
		"/api/v1/projects",
		handler.ProjectsList(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/projects",
		handler.ProjectsCreate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/projects/{projectID}",
		handler.ProjectsGet(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.PATCH(
		"/api/v1/projects/{projectID}",
		handler.ProjectsUpdate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.DELETE(
		"/api/v1/projects/{projectID}",
		handler.ProjectsDelete(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/projects/{projectID}/conversations",
		handler.ProjectConversationsList(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/projects/{projectID}/conversations",
		handler.ProjectConversationsCreate(app),
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

	// PII redaction: per-conversation redaction key (independent of the
	// conversation key) and the sealed token→original mappings. All gated by
	// active conversation participation in the handlers.
	e.Router.GET(
		"/api/v1/conversations/{conversationID}/redaction-key",
		handler.ConversationRedactionKeyGet(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/conversations/{conversationID}/redaction-key",
		handler.ConversationRedactionKeyCreate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/conversations/{conversationID}/redaction-entries",
		handler.ConversationRedactionEntriesList(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/conversations/{conversationID}/redaction-entries",
		handler.ConversationRedactionEntriesCreate(app),
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

	// Encrypted bytes of a shared message's attachment (e.g. a generated image),
	// gated by the share token. Ciphertext — decrypted client-side.
	e.Router.GET(
		"/api/v1/public/conversations/{token}/messages/{messageID}/attachment",
		handler.PublicConversationMessageAttachment(app),
	).Bind(
		rateLimiterMiddleware(app),
	)

	// Redaction mappings for a public share — only resolves for
	// include-sensitive shares; redacted-only shares 404 here.
	e.Router.GET(
		"/api/v1/public/conversations/{token}/redaction-entries",
		handler.PublicConversationRedactionEntriesList(app),
	).Bind(
		rateLimiterMiddleware(app),
	)

	// Public, unauthenticated id→name catalogue so the shared-conversation page
	// can label assistant messages with the model name instead of its raw id.
	e.Router.GET(
		"/api/v1/public/models",
		handler.PublicModelsGet(catalogueService),
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
		BillingService:      billingService,
		BillingStateRepo:    billingStateRepo,
		BillingLedgerRepo:   billingLedgerRepo,
		FXRateProvider:      fxRateProvider,
		UsageEmitter:        usageEmitter,
		CompleteBillingGate: completeBillingGate,
		CompletionStopper:   completionStopper,
		App:                 app,
	}

	attachmentParams := handler.AttachmentHandlerParams{
		App:             app,
		Logger:          logger,
		MaxFileBytes:    attachmentMaxFileBytes,
		StorageCapBytes: attachmentStorageCapBytes,
	}

	compactionParams := handler.CompactionHandlerParams{
		App:               app,
		Logger:            logger,
		CatalogueService:  catalogueService,
		GatewayClient:     gatewayClient,
		ConversationRepo:  conversationRepo,
		CompactionRepo:    compaction.NewPocketBaseRepo(app),
		BillingService:    billingService,
		BillingStateRepo:  billingStateRepo,
		BillingLedgerRepo: billingLedgerRepo,
		FXRateProvider:    fxRateProvider,
		UsageEmitter:      usageEmitter,
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
		"/api/v1/personas",
		handler.PersonasList(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/personas",
		handler.PersonasCreate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.PATCH(
		"/api/v1/personas/{personaID}",
		handler.PersonasUpdate(app),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.DELETE(
		"/api/v1/personas/{personaID}",
		handler.PersonasDelete(app),
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

	// AI-consuming endpoints additionally require a verified email address
	// (handler.RequireVerifiedEmail): completions, regenerate, image generation
	// and model-driven compaction all trigger paid provider calls.
	e.Router.POST(
		"/api/v1/completions",
		handler.Complete(completeParams),
	).Bind(
		apis.RequireAuth(),
		handler.RequireVerifiedEmail(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/completions/{requestID}/stop",
		handler.StopCompletion(completionStopper),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/conversations/{conversationID}/complete",
		handler.CompleteConversation(completeParams),
	).Bind(
		apis.RequireAuth(),
		handler.RequireVerifiedEmail(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/conversations/{conversationID}/regenerate",
		handler.RegenerateConversation(completeParams),
	).Bind(
		apis.RequireAuth(),
		handler.RequireVerifiedEmail(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/conversations/{conversationID}/image",
		handler.GenerateConversationImage(completeParams),
	).Bind(
		apis.RequireAuth(),
		handler.RequireVerifiedEmail(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/conversations/{conversationID}/messages/{messageID}/attachment",
		handler.ConversationMessageAttachment(completeParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	// User-scoped attachment library (spec docs/specs/attachments.md). Files belong
	// to the user and are reusable across conversations; access is gated by file
	// ownership inside the handlers.
	e.Router.POST(
		"/api/v1/attachments",
		handler.LibraryAttachmentCreate(attachmentParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/attachments",
		handler.LibraryAttachmentList(attachmentParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/attachments/{attachmentID}",
		handler.LibraryAttachmentGet(attachmentParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/attachments/{attachmentID}/files/{fileName}",
		handler.LibraryAttachmentDownload(attachmentParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.PATCH(
		"/api/v1/attachments/{attachmentID}",
		handler.LibraryAttachmentRename(attachmentParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.DELETE(
		"/api/v1/attachments/{attachmentID}",
		handler.LibraryAttachmentDelete(attachmentParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/attachments/{attachmentID}/usages",
		handler.LibraryAttachmentUsages(attachmentParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/conversations/{conversationID}/compactions",
		handler.CompactionCreate(compactionParams),
	).Bind(
		apis.RequireAuth(),
		handler.RequireVerifiedEmail(),
		rateLimiterMiddleware(app),
	)

	e.Router.GET(
		"/api/v1/conversations/{conversationID}/compactions",
		handler.CompactionList(compactionParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.POST(
		"/api/v1/conversations/{conversationID}/compactions/manual",
		handler.CompactionCreateManual(compactionParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.PATCH(
		"/api/v1/conversation-compactions/{id}",
		handler.CompactionUpdate(compactionParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	e.Router.DELETE(
		"/api/v1/conversation-compactions/{id}",
		handler.CompactionDelete(compactionParams),
	).Bind(
		apis.RequireAuth(),
		rateLimiterMiddleware(app),
	)

	// User-scoped memory (owned by the authenticated user).
	e.Router.POST("/api/v1/user-memory", handler.UserMemoryCreate(app)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))
	e.Router.GET("/api/v1/user-memory", handler.UserMemoryList(app)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))
	e.Router.PATCH("/api/v1/user-memory/{id}", handler.UserMemoryUpdate(app)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))
	e.Router.DELETE("/api/v1/user-memory/{id}", handler.UserMemoryDelete(app)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))

	// Project-scoped memory (gated by active project membership).
	e.Router.POST("/api/v1/projects/{projectID}/memory", handler.ProjectMemoryCreate(app)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))
	e.Router.GET("/api/v1/projects/{projectID}/memory", handler.ProjectMemoryList(app)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))
	e.Router.PATCH("/api/v1/project-memory/{id}", handler.ProjectMemoryUpdate(app)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))
	e.Router.DELETE("/api/v1/project-memory/{id}", handler.ProjectMemoryDelete(app)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))

	// Scoped redaction (so user/project memory placeholders hydrate everywhere).
	e.Router.GET("/api/v1/user-redaction-entries", handler.UserRedactionEntriesList(app)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))
	e.Router.POST("/api/v1/user-redaction-entries", handler.UserRedactionEntriesCreate(app)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))

	e.Router.GET("/api/v1/projects/{projectID}/redaction-key", handler.ProjectRedactionKeyGet(app)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))
	e.Router.POST("/api/v1/projects/{projectID}/redaction-key", handler.ProjectRedactionKeyCreate(app)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))
	e.Router.GET("/api/v1/projects/{projectID}/redaction-entries", handler.ProjectRedactionEntriesList(app)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))
	e.Router.POST("/api/v1/projects/{projectID}/redaction-entries", handler.ProjectRedactionEntriesCreate(app)).
		Bind(apis.RequireAuth(), rateLimiterMiddleware(app))

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

		// Logging out drops MFA device trust too: a shared/forgotten machine
		// should not stay second-factor-exempt after the user signs out.
		if err := mfaStore.RevokeAllTrustedDevices(re.Auth.Id); err != nil {
			logger.Warn("failed to revoke trusted MFA devices on logout", "err", err)
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
		"personas",
		"Number of personas in the system",
	)

	// Operator-only: exposes aggregate counters (user/conversation/message
	// totals) that must never be readable by a regular authenticated user.
	e.Router.GET(
		"/metrics",
		apis.WrapStdHandler(promhttp.HandlerFor(registry, promhttp.HandlerOpts{})),
	).Bind(
		apis.RequireSuperuserAuth(),
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
