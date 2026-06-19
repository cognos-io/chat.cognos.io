package hooks

import "github.com/pocketbase/pocketbase/core"

// ConfigureRateLimits applies our rate-limit policy. It defers the actual
// mutation until OnServe so the settings PocketBase loads from the database at
// boot do not overwrite our values.
func ConfigureRateLimits(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		ApplyRateLimits(e.App)
		return e.Next()
	})
}

func ApplyRateLimits(app core.App) {
	settings := app.Settings()
	if app.IsDev() {
		settings.RateLimits.Enabled = false
		return
	}

	settings.RateLimits.Enabled = true
	settings.RateLimits.Rules = []core.RateLimitRule{
		{Label: "*:authRefresh", MaxRequests: 30, Duration: 60},
		// Tight per-client cap on password sign-in to slow credential guessing.
		// A genuine user rarely needs more than a handful of attempts in 5 min.
		{Label: "*:authWithPassword", MaxRequests: 10, Duration: 300},
		{Label: "*:requestVerification", MaxRequests: 5, Duration: 300},
		{Label: "*:requestPasswordReset", MaxRequests: 3, Duration: 300},
		{Label: "*:confirmPasswordReset", MaxRequests: 3, Duration: 300},
		{Label: "*:requestEmailChange", MaxRequests: 3, Duration: 300},
		{Label: "*:confirmEmailChange", MaxRequests: 3, Duration: 300},
	}
}
