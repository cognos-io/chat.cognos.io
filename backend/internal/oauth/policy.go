package oauth

import "time"

const (
	// ProviderGoogle is the only OAuth provider Cognos ships today.
	ProviderGoogle = "google"

	// LinkIntentTTL is how long a password-proven link intent stays usable.
	LinkIntentTTL = 10 * time.Minute

	// StepUpChallengeTTL is how long the client has to finish Google re-auth
	// after begin.
	StepUpChallengeTTL = 10 * time.Minute

	// StepUpSessionTTL is how long the minted oauthStepUpId remains valid for
	// account delete.
	StepUpSessionTTL = 5 * time.Minute

	// CreateData keys passed through PocketBase authWithOAuth2 createData.
	// They must never be real users-collection fields.
	CreateDataLinkIntent        = "cognosLinkIntent"
	CreateDataStepUpChallenge   = "cognosStepUpChallenge"
)
