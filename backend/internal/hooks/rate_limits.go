package hooks

import "github.com/pocketbase/pocketbase/core"

func ConfigureRateLimits(app core.App) {
	settings := app.Settings()
	settings.RateLimits.Enabled = true
	settings.RateLimits.Rules = []core.RateLimitRule{
		{Label: "*:authRefresh", MaxRequests: 30, Duration: 60},
		{Label: "*:authWithPassword", MaxRequests: 10, Duration: 300},
		{Label: "*:requestVerification", MaxRequests: 5, Duration: 300},
		{Label: "*:requestPasswordReset", MaxRequests: 3, Duration: 300},
		{Label: "*:confirmPasswordReset", MaxRequests: 3, Duration: 300},
		{Label: "*:requestEmailChange", MaxRequests: 3, Duration: 300},
		{Label: "*:confirmEmailChange", MaxRequests: 3, Duration: 300},
	}
}
