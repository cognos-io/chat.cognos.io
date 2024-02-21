package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/cognos-io/chat.cognos.io/backend/internal/hooks"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"

	_ "github.com/cognos-io/chat.cognos.io/backend/db/migrations" // import migration files
)

func NewServer(
	logger *slog.Logger,
	config *config.APIConfig,
) *pocketbase.PocketBase {
	app := pocketbase.New()

	addPocketBaseRoutes(app, logger, config)

	// Add SoftDelete hook
	hooks.SoftDelete(app)

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

	app := NewServer(
		logger,
		config,
	)

	return app.Start()

}

func main() {
	ctx := context.Background()
	if err := run(ctx, os.Stdout, os.Args); err != nil {
		fmt.Fprintf(os.Stderr, "%s\n", err)
		os.Exit(1)
	}
}
