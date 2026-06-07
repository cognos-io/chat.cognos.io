package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
	"github.com/cognos-io/chat.cognos.io/backend/internal/handler"
	"github.com/cognos-io/chat.cognos.io/backend/internal/hooks"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/aiagent"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/proxy"
	"github.com/go-co-op/gocron/v2"
	"github.com/google/generative-ai-go/genai"
	"github.com/liushuangls/go-anthropic/v2"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	oai "github.com/sashabaranov/go-openai"
	"google.golang.org/api/option"

	_ "github.com/cognos-io/chat.cognos.io/backend/db/migrations" // import migration files
)

type appHookParams struct {
	App                    core.App
	Config                 *config.APIConfig
	OpenaiClient           *oai.Client
	InfomaniakOpenAIClient *oai.Client
	CloudflareOpenAIClient *oai.Client
	GoogleGeminiClient     *genai.Client
	AnthropicClient        *anthropic.Client
	DeepinfraOpenAIClient  *oai.Client
	CronScheduler          gocron.Scheduler
	UpstreamRepo           proxy.UpstreamRepo
	GatewayClient          gateway.Client
	MessageRepo            chat.MessageRepo
	KeyPairRepo            auth.KeyPairRepo
	AIAgentRepo            aiagent.AIAgentRepo
	ConversationRepo       chat.ConversationRepo
	BillingService         *billing.Service
	CompleteBillingGate    handler.CompleteBillingGateFunc
}

func NewServer(
	logger *slog.Logger,
	config *config.APIConfig,
	openaiClient *oai.Client,
) *pocketbase.PocketBase {
	app := pocketbase.New()

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Dir:         "./db/migrations",
		Automigrate: true,
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
		app                    = params.App
		openaiClient           = params.OpenaiClient
		infomaniakOpenAIClient = params.InfomaniakOpenAIClient
		cloudflareOpenAIClient = params.CloudflareOpenAIClient
		googleGeminiClient     = params.GoogleGeminiClient
		anthropicClient        = params.AnthropicClient
		deepinfraClient        = params.DeepinfraOpenAIClient
	)

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		upstreamRepo := params.UpstreamRepo
		if upstreamRepo == nil {
			if infomaniakOpenAIClient == nil {
				infomaniakOpenAIClient = proxy.NewInfomaniakOpenAIClient(params.Config)
			}

			upstreamRepo = proxy.NewInMemoryUpstreamRepo(proxy.RepoParams{
				Logger:                 app.Logger(),
				OpenAIClient:           openaiClient,
				InfomaniakOpenAIClient: infomaniakOpenAIClient,
				CloudflareOpenAIClient: cloudflareOpenAIClient,
				GoogleGeminiAIClient:   googleGeminiClient,
				AnthropicClient:        anthropicClient,
				DeepInfraOpenAIClient:  deepinfraClient,
			})
		}

		if err := ensureActiveProvidersAvailable(upstreamRepo); err != nil {
			return err
		}

		keyPairRepo := params.KeyPairRepo
		if keyPairRepo == nil {
			keyPairRepo = auth.NewPocketBaseKeyPairRepo(app)
		}

		messageRepo := params.MessageRepo
		if messageRepo == nil {
			messageRepo = chat.NewPocketBaseMessageRepo(app)
		}

		aiAgentRepo := params.AIAgentRepo
		if aiAgentRepo == nil {
			aiAgentRepo = aiagent.NewInMemoryAIAgentRepo(app.Logger())
		}

		conversationRepo := params.ConversationRepo
		if conversationRepo == nil {
			conversationRepo = chat.NewPocketBaseConversationRepo(app, keyPairRepo)
		}

		billingService := params.BillingService
		if billingService == nil {
			billingService = billing.NewService()
		}

		gatewayClient := params.GatewayClient
		if gatewayClient == nil {
			gatewayClient = gateway.NewLegacyClient(upstreamRepo)
		}

		addPocketBaseRoutes(
			e,
			app,
			app.Logger(),
			gatewayClient,
			messageRepo,
			aiAgentRepo,
			conversationRepo,
			billingService,
			params.CompleteBillingGate,
		)

		hooks.SoftDelete(app)
		hooks.EnforceSingleUserKeyPair(app)
		hooks.EnforceSingleConversationPublicKey(app)
		hooks.ForbidPasswordReset(app)
		hooks.ForbidUserEmailChangeFlow(app)
		hooks.ForbidUserEmailChanges(app)

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
		}

		return e.Next()
	})

	app.OnRecordAfterCreateSuccess("messages").BindFunc(func(e *core.RecordEvent) error {
		keyPairRepo := auth.NewPocketBaseKeyPairRepo(e.App)
		conversationRepo := chat.NewPocketBaseConversationRepo(e.App, keyPairRepo)

		if err := conversationRepo.SetConversationUpdated(
			e.Record.GetString("conversation"),
		); err != nil {
			return err
		}

		return e.Next()
	})

	if params.CronScheduler != nil {
		app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error {
			if err := params.CronScheduler.Shutdown(); err != nil {
				return err
			}
			return e.Next()
		})
	}
}

func ensureActiveProvidersAvailable(upstreamRepo proxy.UpstreamRepo) error {
	providers := map[string]proxy.Upstream{}

	for _, model := range catalogue.ActiveModels() {
		upstream, ok := providers[model.ProviderID]
		if !ok {
			var err error
			upstream, err = upstreamRepo.Provider(model.ProviderID)
			if err != nil {
				return fmt.Errorf(
					"provider %q is unavailable for model %q: %w",
					model.ProviderID,
					model.ID,
					err,
				)
			}
			providers[model.ProviderID] = upstream
		}

		if model.RequiresNoRetention {
			if err := upstream.EnsureNoRetention(); err != nil {
				return fmt.Errorf(
					"provider %q does not satisfy no-retention for model %q: %w",
					model.ProviderID,
					model.ID,
					err,
				)
			}
		}
	}

	return nil
}

func run(ctx context.Context, w io.Writer, args []string) error {
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

	openaiClient := oai.NewClient(config.OpenAIAPIKey)
	cloudflareOpenAIClient := proxy.NewCloudflareOpenAIClient(config)

	var googleGeminiClient *genai.Client
	if config.GoogleGeminiAPIKey != "" {
		googleGeminiClient, err = genai.NewClient(
			ctx,
			option.WithAPIKey(config.GoogleGeminiAPIKey),
		)
		if err != nil {
			return fmt.Errorf("failed to create Google Gemini client: %w", err)
		}
	} else {
		logger.Warn(
			"Google Gemini API key not set, Gemini models will be unavailable",
		)
	}
	anthropicClient := anthropic.NewClient(
		config.AnthropicAPIKey,
		anthropic.WithBaseURL(config.AnthropicAPIURL),
	)
	infomaniakClient := proxy.NewInfomaniakOpenAIClient(config)
	deepinfraClient := proxy.NewDeepInfraOpenAIClient(config)

	app := NewServer(
		logger,
		config,
		openaiClient,
	)

	bindAppHooks(appHookParams{
		App:                    app,
		Config:                 config,
		OpenaiClient:           openaiClient,
		InfomaniakOpenAIClient: infomaniakClient,
		CloudflareOpenAIClient: cloudflareOpenAIClient,
		AnthropicClient:        anthropicClient,
		GoogleGeminiClient:     googleGeminiClient,
		DeepinfraOpenAIClient:  deepinfraClient,
		CronScheduler:          scheduler,
	})

	scheduler.Start()

	return app.Start()
}

func main() {
	ctx := context.Background()
	if err := run(ctx, os.Stdout, os.Args); err != nil {
		fmt.Fprintf(os.Stderr, "%s\n", err)
		os.Exit(1)
	}
}
