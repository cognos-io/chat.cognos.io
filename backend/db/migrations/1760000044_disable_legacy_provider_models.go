package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Cognos now ships only two AI providers: Infomaniak (Swiss) and Requesty (EU).
// The Bifrost gateway no longer registers OpenAI, Anthropic, Google, Cloudflare
// or DeepInfra, and the startup guard (ensureActiveProvidersConfigured) refuses
// to boot if any active model points at an unconfigured provider.
//
// This forward-only migration is a safety net: it disables any active ai_models
// row whose provider is not infomaniak or requesty (e.g. a record added by hand
// through the admin UI) so a previously-working install still boots after the
// provider removal. It is a no-op on a clean catalogue, which only ever seeded
// Infomaniak models.
func init() {
	m.Register(func(app core.App) error {
		allowed := map[string]struct{}{}
		providers, err := app.FindRecordsByFilter(
			"ai_providers",
			"provider_id = 'infomaniak' || provider_id = 'requesty'",
			"",
			0,
			0,
		)
		if err != nil {
			return err
		}
		for _, provider := range providers {
			allowed[provider.Id] = struct{}{}
		}

		models, err := app.FindRecordsByFilter(
			"ai_models",
			"enabled = true || whitelisted = true",
			"",
			0,
			0,
		)
		if err != nil {
			return err
		}

		for _, model := range models {
			if _, ok := allowed[model.GetString("provider")]; ok {
				continue
			}
			model.Set("enabled", false)
			model.Set("whitelisted", false)
			if err := app.Save(model); err != nil {
				return err
			}
		}

		return nil
	}, func(app core.App) error {
		// Forward-only: we cannot know which rows were previously enabled.
		return nil
	})
}
