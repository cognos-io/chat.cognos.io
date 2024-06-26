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
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/cognos-io/chat.cognos.io/backend/internal/hooks"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/aiagent"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/proxy"
	"github.com/go-co-op/gocron/v2"
	"github.com/google/generative-ai-go/genai"
	"github.com/liushuangls/go-anthropic/v2"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/models"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	oai "github.com/sashabaranov/go-openai"
	"google.golang.org/api/option"

	_ "github.com/cognos-io/chat.cognos.io/backend/db/migrations" // import migration files
)

type appHookParams struct {
	App                    core.App
	Config                 *config.APIConfig
	OpenaiClient           *oai.Client
	CloudflareOpenAIClient *oai.Client
	GoogleGeminiClient     *genai.Client
	AnthropicClient        *anthropic.Client
	DeepinfraOpenAIClient  *oai.Client
	CronScheduler          gocron.Scheduler
}

func NewServer(
	logger *slog.Logger,
	config *config.APIConfig,
	openaiClient *oai.Client,
) *pocketbase.PocketBase {
	app := pocketbase.New()

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Dir:         "./db/migrations", // path to migration files
		Automigrate: true,              // auto creates migration files when making collection changes
	})

	return app
}

// bindAppHooks is PocketBase specific. We add our additional routes and hooks here.
// We extract as its own function so it can be reused in tests.
func bindAppHooks(
	params appHookParams,
) {
	var (
		app                    = params.App
		config                 = params.Config
		openaiClient           = params.OpenaiClient
		cloudflareOpenAIClient = params.CloudflareOpenAIClient
		googleGeminiClient     = params.GoogleGeminiClient
		anthropicClient        = params.AnthropicClient
		deepinfraClient        = params.DeepinfraOpenAIClient
	)

	// Have to use OnBeforeServe to ensure that the app is fully initialized incl. the DB
	// so we can create the various Repos without panic'ing
	app.OnBeforeServe().Add(func(e *core.ServeEvent) error {
		// Separate into collection services
		upstreamRepo := proxy.NewInMemoryUpstreamRepo(proxy.RepoParams{
			Logger:                 app.Logger(),
			OpenAIClient:           openaiClient,
			CloudflareOpenAIClient: cloudflareOpenAIClient,
			GoogleGeminiAIClient:   googleGeminiClient,
			AnthropicClient:        anthropicClient,
			DeepInfraOpenAIClient:  deepinfraClient,
		},
		)
		messageRepo := chat.NewPocketBaseMessageRepo(app)
		keyPairRepo := auth.NewPocketBaseKeyPairRepo(app)
		aiAgentRepo := aiagent.NewInMemoryAIAgentRepo(app.Logger())
		conversationRepo := chat.NewPocketBaseConversationRepo(app, keyPairRepo)

		addPocketBaseRoutes(
			e,
			app,
			app.Logger(),
			config,
			upstreamRepo,
			messageRepo,
			keyPairRepo,
			aiAgentRepo,
			conversationRepo,
		)

		// Add SoftDelete hook
		hooks.SoftDelete(app)

		return nil
	})

	// When a message is created then update the conversation updated time.
	// This means the user will see the conversations they have most recently interacted with at the top of the list.
	app.OnModelAfterCreate("messages").
		Add(func(e *core.ModelEvent) error {
			keyPairRepo := auth.NewPocketBaseKeyPairRepo(app)
			conversationRepo := chat.NewPocketBaseConversationRepo(app, keyPairRepo)

			return conversationRepo.SetConversationUpdated(
				e.Model.(*models.Record).GetString("conversation"),
			)
		})

	app.OnAfterBootstrap().Add(func(e *core.BootstrapEvent) error {
		expiredMessagesRepo := chat.NewPocketBaseMessageRepo(app)
		_, err := cleanUpExpiredMessageJob(
			params.CronScheduler,
			app.Logger(),
			expiredMessagesRepo,
		)
		return err
	})

	app.OnTerminate().Add(func(e *core.TerminateEvent) error {
		return params.CronScheduler.Shutdown()
	})
}

func run(ctx context.Context, w io.Writer, args []string) error {
	_, cancel := signal.NotifyContext(ctx, os.Interrupt)
	defer cancel()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	config := config.MustLoadAPIConfig(logger)

	// Job scheduler for background tasks
	scheduler, err := gocron.NewScheduler(
		gocron.WithLogger(logger),
		gocron.WithStopTimeout(3*time.Second),
	)
	if err != nil {
		return fmt.Errorf("failed to create scheduler: %w", err)
	}

	// Clients
	openaiClient := oai.NewClient(config.OpenAIAPIKey) // OpenAI
	cloudflareOpenAIClient := proxy.NewCloudflareOpenAIClient(
		config,
	) // Cloudflare with OpenAI compatibility
	googleGeminiClient, err := genai.NewClient(
		ctx,
		option.WithAPIKey(config.GoogleGeminiAPIKey),
	) // Google Gemini
	if err != nil {
		return fmt.Errorf("failed to create Google Gemini client: %w", err)
	}
	anthropicClient := anthropic.NewClient(
		config.AnthropicAPIKey,
		anthropic.WithBaseURL(config.AnthropicAPIURL),
	) // Anthropic
	// DeepInfra
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
		CloudflareOpenAIClient: cloudflareOpenAIClient,
		AnthropicClient:        anthropicClient,
		GoogleGeminiClient:     googleGeminiClient,
		DeepinfraOpenAIClient:  deepinfraClient,
		CronScheduler:          scheduler,
	})

	// start the scheduler which will run in the background
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
