package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/analytics"
	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue/requestysync"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
	"github.com/cognos-io/chat.cognos.io/backend/internal/handler"
	"github.com/cognos-io/chat.cognos.io/backend/internal/hooks"
	"github.com/cognos-io/chat.cognos.io/backend/internal/mfa"
	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
	"github.com/cognos-io/chat.cognos.io/backend/internal/retention"
	"github.com/go-co-op/gocron/v2"
	bifrostschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/spf13/cobra"

	_ "github.com/cognos-io/chat.cognos.io/backend/db/migrations" // import migration files
)

type appHookParams struct {
	App                     core.App
	Config                  *config.APIConfig
	CronScheduler           gocron.Scheduler
	GatewayClient           gateway.Client
	MessageRepo             chat.MessageRepo
	KeyPairRepo             auth.KeyPairRepo
	ConversationRepo        chat.ConversationRepo
	BillingService          *billing.Service
	BillingStateRepo        billing.StateRepo
	BillingLedgerRepo       billing.LedgerRepo
	BillingTransactionsRepo billing.TransactionsRepo
	FXRateProvider          billing.FXRateProvider
	UsageEmitter            analytics.Emitter
	CompleteBillingGate     handler.CompleteBillingGateFunc
	CompletionStopper       *handler.CompletionStopper
	CatalogueService        catalogue.Service
	PaddleClient            paddle.Client
	// Attachment storage caps. Zero means "use the handler default". Exposed
	// here primarily so tests can inject tiny caps without uploading real
	// megabytes/gigabytes.
	AttachmentMaxFileBytes    int64
	AttachmentStorageCapBytes int64
}

func NewServer() *pocketbase.PocketBase {
	app := pocketbase.New()

	var publicDir string
	app.RootCmd.PersistentFlags().StringVar(
		&publicDir,
		"publicDir",
		"",
		"the directory to serve static files from",
	)

	var indexFallback bool
	app.RootCmd.PersistentFlags().BoolVar(
		&indexFallback,
		"indexFallback",
		false,
		"fallback static file requests to index.html for SPA routes",
	)

	var tlsCert string
	app.RootCmd.PersistentFlags().StringVar(
		&tlsCert,
		"tlsCert",
		"",
		"the TLS certificate file to use for HTTPS",
	)

	var tlsKey string
	app.RootCmd.PersistentFlags().StringVar(
		&tlsKey,
		"tlsKey",
		"",
		"the TLS private key file to use for HTTPS",
	)

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Dir:         "./db/migrations",
		Automigrate: true,
	})

	// Manual entrypoint for the Requesty model enrichment that the background
	// job also runs — handy for CI/ops and the scripts/ wrapper.
	syncCmd := &cobra.Command{
		Use:   "sync-requesty-models",
		Short: "Enrich curated Requesty models with fresh metadata from Requesty",
		Run: func(cmd *cobra.Command, _ []string) {
			cfg := config.MustLoadAPIConfig(app.Logger())
			force, _ := cmd.Flags().GetBool("force-disable-absent")
			service := requestysync.NewService(
				app,
				requestysync.NewClient(cfg.RequestyAPIURL, cfg.RequestyAPIKey),
				app.Logger(),
			)
			opts := requestysync.SyncOptions{
				ForceDisableAbsent: force || cfg.RequestyForceDisableAbsent,
			}
			if _, err := service.Run(cmd.Context(), opts); err != nil {
				app.Logger().Error("requesty model sync failed", "err", err)
			}
		},
	}
	// Bypass the health guard and disable every model absent from the fetch — for
	// a manual cleanup after intentionally removing models from Requesty.
	syncCmd.Flags().Bool("force-disable-absent", false,
		"disable models missing from Requesty even if many are absent (manual cleanup)")
	app.RootCmd.AddCommand(syncCmd)

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		if tlsCert == "" && tlsKey == "" {
			return e.Next()
		}
		if tlsCert == "" || tlsKey == "" {
			return fmt.Errorf("--tlsCert and --tlsKey must be provided together")
		}

		cert, err := tls.LoadX509KeyPair(tlsCert, tlsKey)
		if err != nil {
			return fmt.Errorf("load TLS certificate: %w", err)
		}

		cfg := &tls.Config{MinVersion: tls.VersionTLS12}
		if e.Server.TLSConfig != nil {
			cfg = e.Server.TLSConfig.Clone()
		}
		cfg.Certificates = []tls.Certificate{cert}
		cfg.GetCertificate = nil
		e.Server.TLSConfig = cfg

		return e.Next()
	})

	app.OnServe().Bind(&hook.Handler[*core.ServeEvent]{
		Func: func(e *core.ServeEvent) error {
			if publicDir != "" && !e.Router.HasRoute(http.MethodGet, "/{path...}") {
				e.Router.GET("/{path...}", apis.Static(os.DirFS(publicDir), indexFallback))
			}

			return e.Next()
		},
		Priority: 999,
	})

	return app
}

// bindAppHooks is PocketBase specific. We add our additional routes and hooks here.
// We extract as its own function so it can be reused in tests.
func bindAppHooks(
	params appHookParams,
) {
	hooks.ConfigureRateLimits(params.App)

	var (
		app            = params.App
		managedGateway gateway.Client
	)

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		catalogueService := params.CatalogueService
		if catalogueService == nil {
			catalogueService = catalogue.NewCachedService(
				catalogue.NewPocketBaseRepo(app),
				catalogue.DefaultCacheTTL,
				nil,
			)
		}

		if params.GatewayClient == nil && managedGateway == nil {
			account, err := gateway.NewStaticAccountFromAPIConfig(params.Config)
			if err != nil {
				return err
			}
			logBifrostProviderConfig(app.Logger(), account, bifrostschemas.ModelProvider("infomaniak"))
			logBifrostProviderConfig(app.Logger(), account, bifrostschemas.ModelProvider("requesty"))
			if err := ensureActiveProvidersConfigured(context.Background(), catalogueService, account); err != nil {
				return err
			}
			// Never let bifrost log more verbosely than warn outside dev mode —
			// the upstream library may log request bodies (plaintext prompts)
			// at debug/info, and Cognos never logs user content.
			bifrostLogLevel, clamped := gateway.ClampBifrostLogLevel(params.Config.BifrostLogLevel, app.IsDev())
			if clamped {
				app.Logger().Warn(
					"bifrost log level clamped outside dev mode (debug/info may log plaintext prompts)",
					"configured", params.Config.BifrostLogLevel,
					"effective", bifrostLogLevel,
				)
			}
			bifrostClient, err := gateway.NewConfiguredBifrostClient(account, bifrostLogLevel, app.Logger())
			if err != nil {
				return err
			}
			// Resolve provider grounding-redirect citation URLs (Vertex/Gemini) to
			// their destination per completion — no server-side cache, no click
			// tracking, never logging a URL.
			bifrostClient.SetGroundingResolver(
				gateway.NewHTTPGroundingResolver(params.Config.GatewayGroundingRedirectPrefix, app.Logger()),
			)
			managedGateway = bifrostClient
			catalogueService.Invalidate()
		}

		// Bust the catalogue cache whenever a model or provider record changes so
		// capability edits (e.g. toggling a model's web-search support) take effect
		// on the next request rather than after the cache TTL. Otherwise a stale
		// cache would keep serving pre-edit capability flags for up to the TTL.
		for _, collection := range []string{"ai_models", "ai_providers"} {
			app.OnRecordAfterCreateSuccess(collection).BindFunc(func(e *core.RecordEvent) error {
				catalogueService.Invalidate()
				return e.Next()
			})
			app.OnRecordAfterUpdateSuccess(collection).BindFunc(func(e *core.RecordEvent) error {
				catalogueService.Invalidate()
				return e.Next()
			})
			app.OnRecordAfterDeleteSuccess(collection).BindFunc(func(e *core.RecordEvent) error {
				catalogueService.Invalidate()
				return e.Next()
			})
		}

		keyPairRepo := params.KeyPairRepo
		if keyPairRepo == nil {
			keyPairRepo = auth.NewPocketBaseKeyPairRepo(app)
		}

		messageRepo := params.MessageRepo
		if messageRepo == nil {
			messageRepo = chat.NewPocketBaseMessageRepo(app)
		}

		conversationRepo := params.ConversationRepo
		if conversationRepo == nil {
			conversationRepo = chat.NewPocketBaseConversationRepo(app, keyPairRepo)
		}

		billingService := params.BillingService
		if billingService == nil {
			marginBPS := int64(billing.DefaultMarginBPS)
			webSearchFloorMicroRappen := int64(billing.DefaultWebSearchFloorMicroRappen)
			if params.Config != nil {
				if params.Config.BillingMarginBPS > 0 {
					marginBPS = params.Config.BillingMarginBPS
				}
				if params.Config.BillingWebSearchFloorMicroRappen > 0 {
					webSearchFloorMicroRappen = params.Config.BillingWebSearchFloorMicroRappen
				}
			}
			billingService = billing.NewServiceWithOptions(marginBPS, webSearchFloorMicroRappen)
		}

		billingRepo := billing.NewPocketBaseRepo(app)
		billingStateRepo := params.BillingStateRepo
		if billingStateRepo == nil {
			billingStateRepo = billingRepo
		}
		billingLedgerRepo := params.BillingLedgerRepo
		if billingLedgerRepo == nil {
			billingLedgerRepo = billingRepo
		}
		billingTransactionsRepo := params.BillingTransactionsRepo
		if billingTransactionsRepo == nil {
			billingTransactionsRepo = billingRepo
		}

		fxRateProvider := params.FXRateProvider
		if fxRateProvider == nil {
			// Wrap the env-driven fallback in a 24h TTL cache so the
			// completion hot path never re-reads the env on every request
			// and stays compatible with the cached live-rate provider we
			// will introduce alongside an upstream feed later.
			fxRateProvider = billing.NewCachedFXRateProvider(
				billing.NewFallbackFXRateProvider(),
				billing.DefaultFXRateCacheTTL,
				nil,
			)
		}

		gatewayClient := params.GatewayClient
		if gatewayClient == nil {
			gatewayClient = managedGateway
		}

		usageEmitter := params.UsageEmitter
		if usageEmitter == nil {
			// Buffer usage events in-process and forward them to a structured
			// log sink so analytics never blocks the completion hot path and
			// never persists plaintext content (UsageEvent excludes prompts
			// and direct identifiers by construction).
			usageEmitter = analytics.NewBufferedEmitter(
				analytics.NewLoggerSink(app.Logger()),
				analytics.DefaultBufferedEmitterBatchSize,
				analytics.DefaultBufferedEmitterFlushInterval,
				nil,
				app.Logger(),
			)
		}

		// Paddle is optional: without an API key the checkout route returns 503
		// rather than crashing local/dev setups that don't transact.
		paddleClient := params.PaddleClient
		if paddleClient == nil && params.Config != nil && params.Config.PaddleAPIKey != "" {
			paddleClient = paddle.NewHTTPClient(params.Config.PaddleAPIBase, params.Config.PaddleAPIKey)
		}
		paddlePrices := map[string]string{}
		paddleWebhookSecret := ""
		paddleMinCommitRappen := int64(billing.DefaultPAYGMinCommitRappen)
		paddleOveragePriceID := ""
		paddlePriceToPlan := map[string]billing.PlanType{}
		if params.Config != nil {
			if params.Config.BillingPaygMinCommitRappen > 0 {
				paddleMinCommitRappen = params.Config.BillingPaygMinCommitRappen
			}
			paddleOveragePriceID = params.Config.PaddlePricePAYGOverage
			paddlePrices = map[string]string{
				"payg":              params.Config.PaddlePricePAYG,
				"unlimited_monthly": params.Config.PaddlePriceUnlimitedMonthly,
				"unlimited_annual":  params.Config.PaddlePriceUnlimitedAnnual,
			}
			paddleWebhookSecret = params.Config.PaddleWebhookSecret
			// Reverse map: which plan does each configured price activate?
			for priceID, plan := range map[string]billing.PlanType{
				params.Config.PaddlePricePAYG:             billing.PlanTypePayG,
				params.Config.PaddlePriceUnlimitedMonthly: billing.PlanTypeUnlimited,
				params.Config.PaddlePriceUnlimitedAnnual:  billing.PlanTypeUnlimited,
			} {
				if priceID != "" {
					paddlePriceToPlan[priceID] = plan
				}
			}
		}

		// Plan + interval per price, for the billing dashboard.
		paddlePlanByPrice := map[string]handler.PlanMeta{}
		if params.Config != nil {
			for priceID, meta := range map[string]handler.PlanMeta{
				params.Config.PaddlePricePAYG:             {Plan: billing.PlanTypePayG, Interval: "monthly"},
				params.Config.PaddlePriceUnlimitedMonthly: {Plan: billing.PlanTypeUnlimited, Interval: "monthly"},
				params.Config.PaddlePriceUnlimitedAnnual:  {Plan: billing.PlanTypeUnlimited, Interval: "annual"},
			} {
				if priceID != "" {
					paddlePlanByPrice[priceID] = meta
				}
			}
		}

		completionStopper := params.CompletionStopper
		if completionStopper == nil {
			completionStopper = handler.NewCompletionStopper()
		}

		// TOTP seed cipher. Absent key => enrolment endpoints report "not
		// configured" rather than ever storing a plaintext seed. A present but
		// malformed key is a hard boot error.
		var mfaCipher *mfa.SeedCipher
		if params.Config != nil && params.Config.MFATOTPEncryptionKey != "" {
			c, err := mfa.NewSeedCipher(params.Config.MFATOTPEncryptionKey)
			if err != nil {
				return fmt.Errorf("mfa: invalid TOTP encryption key: %w", err)
			}
			mfaCipher = c
		}

		addPocketBaseRoutes(
			e,
			app,
			app.Logger(),
			catalogueService,
			gatewayClient,
			messageRepo,
			conversationRepo,
			billingService,
			billingStateRepo,
			billingLedgerRepo,
			billingTransactionsRepo,
			fxRateProvider,
			usageEmitter,
			params.CompleteBillingGate,
			completionStopper,
			paddleClient,
			paddlePrices,
			paddleWebhookSecret,
			paddlePriceToPlan,
			billingRepo,
			paddlePlanByPrice,
			paddleMinCommitRappen,
			paddleOveragePriceID,
			params.AttachmentMaxFileBytes,
			params.AttachmentStorageCapBytes,
			mfaCipher,
		)

		hooks.SoftDelete(app)
		hooks.EnforceSingleUserKeyPair(app)
		hooks.EnforceSingleConversationPublicKey(app)
		// Password reset and email change are both allowed: under the
		// account_key_v2 scheme the email and password are authentication-only
		// metadata, never inputs to the data key, so changing either never
		// affects encrypted data (see docs/security-model.md §9/§10). Email
		// changes still go through PocketBase's verified request → confirm flow;
		// this guard only blocks an unverified email swap via a direct PATCH.
		hooks.ForbidUserEmailChanges(app)
		// Per-account brute-force lockout, on top of the per-IP rate limit.
		hooks.EnforceLoginLockout(app)
		// Authenticator-app MFA: withhold the auth token for enrolled users until
		// a second factor is supplied (docs/specs/mfa-and-passkeys.md).
		hooks.EnforceMFALogin(app, mfa.NewStore(app))

		if params.CronScheduler != nil {
			expiredMessagesRepo := chat.NewPocketBaseMessageRepo(app)
			_, err := cleanUpExpiredMessageJob(
				params.CronScheduler,
				app.Logger(),
				expiredMessagesRepo,
			)
			if err != nil {
				return err
			}

			deletedRecordRepo := hooks.NewPocketBaseDeletedRecordRepo(app)
			_, err = cleanUpDeletedRecordJob(
				params.CronScheduler,
				app.Logger(),
				deletedRecordRepo,
			)
			if err != nil {
				return err
			}

			expiredConversationsRepo := retention.NewPocketBaseRepo(app)
			_, err = cleanUpExpiredConversationsJob(
				params.CronScheduler,
				app.Logger(),
				expiredConversationsRepo,
			)
			if err != nil {
				return err
			}

			vaultSessionRepo := hooks.NewPocketBaseVaultSessionWrapKeyRepo(app)
			_, err = cleanUpIdleVaultSessionsJob(
				params.CronScheduler,
				app.Logger(),
				vaultSessionRepo,
			)
			if err != nil {
				return err
			}

			// Keep curated Requesty models current (reasoning/pricing/context).
			if params.Config != nil && params.Config.RequestyAPIKey != "" {
				if _, err = syncRequestyModelsJob(
					params.CronScheduler,
					app,
					app.Logger(),
					params.Config.RequestyAPIURL,
					params.Config.RequestyAPIKey,
					params.Config.RequestyForceDisableAbsent,
				); err != nil {
					return err
				}
			}

			if paddleClient != nil && paddleOveragePriceID != "" {
				_, err = retryPaygOverageJob(
					params.CronScheduler,
					app.Logger(),
					billingRepo,
					paddleClient,
					paddleOveragePriceID,
				)
				if err != nil {
					return err
				}
			}

			fairUseThreshold := int64(billing.DefaultFairUseAlertRappen)
			if params.Config != nil && params.Config.BillingUnlimitedFairUseAlertRappen > 0 {
				fairUseThreshold = params.Config.BillingUnlimitedFairUseAlertRappen
			}
			if _, err = fairUseReportJob(
				params.CronScheduler, app.Logger(), billingRepo, fairUseThreshold,
			); err != nil {
				return err
			}
		}

		return e.Next()
	})

	billingTrialSeedRappen := int64(billing.DefaultTrialSeedRappen)
	if params.Config != nil && params.Config.BillingTrialSeedRappen > 0 {
		billingTrialSeedRappen = params.Config.BillingTrialSeedRappen
	}

	app.OnRecordAfterCreateSuccess("users").BindFunc(func(e *core.RecordEvent) error {
		if err := billing.NewPocketBaseRepo(e.App).EnsureTrialState(e.Record.Id, billingTrialSeedRappen); err != nil {
			return err
		}
		return e.Next()
	})

	app.OnRecordAfterCreateSuccess("messages").BindFunc(func(e *core.RecordEvent) error {
		keyPairRepo := auth.NewPocketBaseKeyPairRepo(e.App)
		conversationRepo := chat.NewPocketBaseConversationRepo(e.App, keyPairRepo)

		if err := conversationRepo.BumpActivity(
			e.Record.GetString("conversation"),
			chat.ActivityMessageCreated,
		); err != nil {
			return err
		}

		return e.Next()
	})

	app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error {
		if managedGateway != nil {
			if shutdowner, ok := managedGateway.(interface{ Shutdown() }); ok {
				shutdowner.Shutdown()
			}
		}
		if params.CronScheduler != nil {
			if err := params.CronScheduler.Shutdown(); err != nil {
				return err
			}
		}
		return e.Next()
	})
}

func ensureActiveProvidersConfigured(
	ctx context.Context,
	catalogueService catalogue.Service,
	account bifrostschemas.Account,
) error {
	if account == nil || catalogueService == nil {
		return nil
	}

	models, err := catalogueService.ActiveModels(ctx)
	if err != nil {
		return err
	}

	validatedProviders := map[string]struct{}{}
	for _, model := range models {
		if _, ok := validatedProviders[model.ProviderID]; ok {
			continue
		}

		providerKey := bifrostschemas.ModelProvider(model.ProviderID)
		providerConfig, err := account.GetConfigForProvider(providerKey)
		if err != nil {
			return fmt.Errorf("provider %q is unavailable for model %q: %w", model.ProviderID, model.ID, err)
		}
		keys, err := account.GetKeysForProvider(ctx, providerKey)
		if err != nil {
			return fmt.Errorf("provider %q has no configured keys for model %q: %w", model.ProviderID, model.ID, err)
		}
		if len(keys) == 0 && (providerConfig.CustomProviderConfig == nil || !providerConfig.CustomProviderConfig.IsKeyLess) {
			return fmt.Errorf("provider %q has no configured keys for model %q", model.ProviderID, model.ID)
		}
		if model.NoRetention && providerUsesOpenAIStore(providerConfig) {
			return fmt.Errorf("provider %q is not configured to disable provider-side storage for model %q", model.ProviderID, model.ID)
		}

		validatedProviders[model.ProviderID] = struct{}{}
	}

	return nil
}

func providerUsesOpenAIStore(providerConfig *bifrostschemas.ProviderConfig) bool {
	if providerConfig == nil {
		return false
	}
	if providerConfig.OpenAIConfig == nil {
		return false
	}
	return !providerConfig.OpenAIConfig.DisableStore
}

func logBifrostProviderConfig(logger *slog.Logger, account bifrostschemas.Account, provider bifrostschemas.ModelProvider) {
	if logger == nil || account == nil {
		return
	}

	providerConfig, err := account.GetConfigForProvider(provider)
	if err != nil || providerConfig == nil {
		return
	}

	baseProviderType := ""
	if providerConfig.CustomProviderConfig != nil {
		baseProviderType = string(providerConfig.CustomProviderConfig.BaseProviderType)
	}

	logger.Info(
		"configured bifrost provider",
		"provider", provider,
		"base_url", providerConfig.NetworkConfig.BaseURL,
		"base_provider_type", baseProviderType,
		"disable_store", providerConfig.OpenAIConfig != nil && providerConfig.OpenAIConfig.DisableStore,
	)
}

func run(ctx context.Context, w io.Writer, args []string, getenv func(string) string) error {
	_, cancel := signal.NotifyContext(ctx, os.Interrupt)
	defer cancel()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	config := config.MustLoadAPIConfig(logger)

	scheduler, err := gocron.NewScheduler(
		gocron.WithLogger(logger),
		gocron.WithStopTimeout(3*time.Second),
	)
	if err != nil {
		return fmt.Errorf("failed to create scheduler: %w", err)
	}

	app := NewServer()
	unixSocket, unixSocketSet, err := loadUnixSocketConfig(getenv)
	if err != nil {
		return err
	}
	if unixSocketSet {
		bindUnixSocket(app, unixSocket)
	}

	bindAppHooks(appHookParams{
		App:           app,
		Config:        config,
		CronScheduler: scheduler,
	})

	scheduler.Start()

	return app.Start()
}

func main() {
	ctx := context.Background()
	if err := run(ctx, os.Stdout, os.Args, os.Getenv); err != nil {
		fmt.Fprintf(os.Stderr, "%s\n", err)
		os.Exit(1)
	}
}
