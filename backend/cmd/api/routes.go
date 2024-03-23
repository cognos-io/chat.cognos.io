package main

import (
	"log/slog"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/cognos-io/chat.cognos.io/backend/internal/idempotency"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/compat/openai"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	oai "github.com/sashabaranov/go-openai"
)

// addPocketBaseRoutes adds additional routes to the PocketBase app.
func addPocketBaseRoutes(
	e *core.ServeEvent,
	app core.App,
	logger *slog.Logger,
	config *config.APIConfig,
	openaiClient *oai.Client,
	messageRepo chat.MessageRepo,
	keyPairRepo auth.KeyPairRepo,
	idempotencyRepo idempotency.IdempotencyRepo,
) {
	// https://platform.openai.com/docs/api-reference/chat/create
	e.Router.POST(
		"/v1/chat/completions",
		openai.EchoHandler(
			config,
			logger,
			openaiClient,
			messageRepo,
			keyPairRepo,
		),
		apis.RequireRecordAuth(),
	)
}
