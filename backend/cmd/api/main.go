package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"

	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/cognos-io/chat.cognos.io/backend/internal/hooks"
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

func run(ctx context.Context, w io.Writer, args []string) error {

	ctx, cancel := signal.NotifyContext(ctx, os.Interrupt)
	defer cancel()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	config := config.MustLoadAPIConfig()

	openaiClient := oai.NewClient(config.OpenAIAPIKey)

	app := NewServer(
		logger,
		config,
		openaiClient,
	)

	// Have to use OnAfterBootstrap to ensure that the app is fully initialized incl. the DB
	// so we can create the various Repos without panic'ing
	app.OnAfterBootstrap().Add(func(e *core.BootstrapEvent) error {
		// Separate into collection services
		messageRepo, err := chat.NewPocketBaseMessageRepo(app)
		if err != nil {
			panic(err)
		}

		addPocketBaseRoutes(app, app.Logger(), config, openaiClient, messageRepo)

		// Add SoftDelete hook
		hooks.SoftDelete(app)

		return nil

	})

	return app.Start()

}

func main() {
	ctx := context.Background()
	if err := run(ctx, os.Stdout, os.Args); err != nil {
		fmt.Fprintf(os.Stderr, "%s\n", err)
		os.Exit(1)
	}
}
