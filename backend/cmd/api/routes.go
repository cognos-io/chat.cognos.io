package main

import (
	"log/slog"

	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/compat/openai"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	oai "github.com/sashabaranov/go-openai"
)

// addPocketBaseRoutes adds additional routes to the PocketBase app.
func addPocketBaseRoutes(app core.App, logger *slog.Logger, config *config.APIConfig, openaiClient *oai.Client, messageRepo chat.MessageRepo) {
	app.OnBeforeServe().Add(func(e *core.ServeEvent) error {
		// https://platform.openai.com/docs/api-reference/chat/create
		e.Router.POST("/v1/chat/completions", openai.EchoHandler(logger, openaiClient, messageRepo), apis.RequireRecordAuth())
		return nil
	})
}
