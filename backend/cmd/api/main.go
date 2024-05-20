package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/cognos-io/chat.cognos.io/backend/internal/hooks"
	"github.com/cognos-io/chat.cognos.io/backend/internal/idempotency"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/proxy"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	oai "github.com/sashabaranov/go-openai"

	_ "github.com/cognos-io/chat.cognos.io/backend/db/migrations" // import migration files
)

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
	app core.App,
	config *config.APIConfig,
	openaiClient *oai.Client,
	cloudflareOpenAIClient *oai.Client,
) {
	// Have to use OnBeforeServe to ensure that the app is fully initialized incl. the DB
	// so we can create the various Repos without panic'ing
	app.OnBeforeServe().Add(func(e *core.ServeEvent) error {
		// Separate into collection services
		upstreamRepo := proxy.NewInMemoryUpstreamRepo(
			app.Logger(),
			openaiClient,
			cloudflareOpenAIClient,
		)
		messageRepo := chat.NewPocketBaseMessageRepo(app)
		keyPairRepo := auth.NewPocketBaseKeyPairRepo(app)
		idempotencyRepo := idempotency.NewPocketBaseIdempotencyRepo(app)

		addPocketBaseRoutes(
			e,
			app,
			app.Logger(),
			config,
			upstreamRepo,
			messageRepo,
			keyPairRepo,
			idempotencyRepo,
		)

		// Add SoftDelete hook
		hooks.SoftDelete(app)

		return nil
	})
}

func run(ctx context.Context, w io.Writer, args []string) error {
	_, cancel := signal.NotifyContext(ctx, os.Interrupt)
	defer cancel()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	config := config.MustLoadAPIConfig(logger)

	// Clients
	openaiClient := oai.NewClient(config.OpenAIAPIKey) // OpenAI
	cloudflareOpenAIClient := proxy.NewCloudflareOpenAIClient(
		config,
	) // Cloudflare with OpenAI compatibility

	app := NewServer(
		logger,
		config,
		openaiClient,
	)

	bindAppHooks(app, config, openaiClient, cloudflareOpenAIClient)

	return app.Start()
}

func main() {
	ctx := context.Background()
	if err := run(ctx, os.Stdout, os.Args); err != nil {
		fmt.Fprintf(os.Stderr, "%s\n", err)
		os.Exit(1)
	}
}
