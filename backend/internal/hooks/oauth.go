package hooks

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/oauth"
)

// EnforceOAuthRules implements the Google OAuth business processes:
//
//   - No silent email auto-link onto a password Account
//     (docs/business_processes/oauth-account-link.md)
//   - Intentional link requires a consumed link intent
//   - New OAuth Accounts are marked has_cognos_password=false
//   - Step-up challenges are confirmed when createData carries the challenge id
//
// See docs/business_processes/oauth-google-sign-in.md.
func EnforceOAuthRules(app core.App, store *oauth.Store) {
	app.OnRecordAuthWithOAuth2Request("users").BindFunc(func(e *core.RecordAuthWithOAuth2RequestEvent) error {
		provider := e.ProviderName
		if provider == "" {
			provider = oauth.ProviderGoogle
		}

		linkIntent, _ := createDataString(e.CreateData, oauth.CreateDataLinkIntent)
		stepUpChallenge, _ := createDataString(e.CreateData, oauth.CreateDataStepUpChallenge)

		// Strip Cognos-only createData keys so they never land on the user row
		// if this is a new-record create.
		if e.CreateData != nil {
			delete(e.CreateData, oauth.CreateDataLinkIntent)
			delete(e.CreateData, oauth.CreateDataStepUpChallenge)
		}

		authedID := ""
		if e.Auth != nil {
			authedID = e.Auth.Id
		}

		alreadyLinked := false
		if e.Record != nil {
			ext, err := app.FindAllExternalAuthsByRecord(e.Record)
			if err == nil {
				for _, ea := range ext {
					if ea.Provider() == provider {
						alreadyLinked = true
						break
					}
				}
			}
		}

		switch {
		case alreadyLinked && e.Record != nil:
			// Returning Google sign-in (or re-auth for step-up).
			if stepUpChallenge != "" {
				if err := store.ConfirmStepUpChallenge(e.Record.Id, provider, stepUpChallenge); err != nil {
					return e.BadRequestError("Invalid or expired Google re-authentication challenge", err)
				}
			}
			return e.Next()

		case e.IsNewRecord:
			// Brand-new Google Account. has_cognos_password stays false (default);
			// password signup sets it true in MarkCognosPasswordOnAuthCreate.
			return e.Next()

		case e.Record != nil && authedID != "" && authedID == e.Record.Id:
			// Intentional link while signed in as this Account.
			if linkIntent == "" {
				return e.JSON(http.StatusUnauthorized, map[string]any{
					"code":    "OAUTH_LINK_INTENT_REQUIRED",
					"message": "Confirm your password before connecting Google.",
				})
			}
			if err := store.ConsumeLinkIntent(e.Record.Id, provider, linkIntent); err != nil {
				return e.JSON(http.StatusUnauthorized, map[string]any{
					"code":    "OAUTH_LINK_INTENT_REQUIRED",
					"message": "Confirm your password before connecting Google.",
				})
			}
			return e.Next()

		case e.Record != nil:
			// Email matches an existing Account and this is not an intentional
			// authenticated link — refuse silent merge.
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"code":    "ACCOUNT_EXISTS_USE_PASSWORD",
				"message": "An account with this email already exists. Sign in with your password, then connect Google in settings.",
			})

		default:
			return e.Next()
		}
	})
}

// MarkCognosPasswordOnAuthCreate sets has_cognos_password when a user is created
// with a client-supplied password (email/password signup).
func MarkCognosPasswordOnAuthCreate(app core.App) {
	app.OnRecordCreateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.Record == nil {
			return e.Next()
		}
		// OAuth create uses SetRandomPassword with an empty plain value; password
		// signup submits a plain password on the record.
		if pv, ok := e.Record.GetRaw(core.FieldNamePassword).(*core.PasswordFieldValue); ok && pv.Plain != "" {
			e.Record.Set("has_cognos_password", true)
		}
		return e.Next()
	})

	app.OnRecordConfirmPasswordResetRequest("users").BindFunc(func(e *core.RecordConfirmPasswordResetRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if e.Record != nil {
			e.Record.Set("has_cognos_password", true)
			_ = app.Save(e.Record)
		}
		return nil
	})
}

func createDataString(data map[string]any, key string) (string, bool) {
	if data == nil {
		return "", false
	}
	v, ok := data[key]
	if !ok {
		return "", false
	}
	s, ok := v.(string)
	if !ok || s == "" {
		return "", false
	}
	return s, true
}
