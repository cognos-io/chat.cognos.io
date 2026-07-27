package hooks

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/pocketbase/dbx"
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
		if provider != oauth.ProviderGoogle {
			return e.BadRequestError("Unsupported OAuth provider.", nil)
		}
		if e.OAuth2User == nil || strings.TrimSpace(e.OAuth2User.Id) == "" {
			return e.BadRequestError("Google did not return a stable identity.", nil)
		}
		if e.IsNewRecord && strings.TrimSpace(e.OAuth2User.Email) == "" {
			return e.BadRequestError("Google did not return a verified email.", nil)
		}

		linkIntent, linkIntentValid := createDataString(e.CreateData, oauth.CreateDataLinkIntent)
		_, linkIntentPresent := e.CreateData[oauth.CreateDataLinkIntent]
		stepUpChallenge, stepUpChallengeValid := createDataString(e.CreateData, oauth.CreateDataStepUpChallenge)
		_, stepUpChallengePresent := e.CreateData[oauth.CreateDataStepUpChallenge]
		switch {
		case (linkIntentPresent && !linkIntentValid) || (stepUpChallengePresent && !stepUpChallengeValid):
			return e.BadRequestError("Invalid Cognos OAuth proof data.", nil)
		case linkIntentPresent && stepUpChallengePresent:
			return e.BadRequestError("Choose either Google account linking or re-authentication.", nil)
		}

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

		providerID := ""
		if e.OAuth2User != nil {
			providerID = e.OAuth2User.Id
		}
		alreadyLinked, err := exactExternalAuthExists(app, e.Record, provider, providerID)
		if err != nil {
			return e.InternalServerError("Failed OAuth2 relation check.", err)
		}

		if stepUpChallenge != "" {
			if e.Record == nil || !alreadyLinked {
				return e.BadRequestError("Invalid or expired Google re-authentication challenge.", nil)
			}
			if err := store.ValidateStepUpChallenge(e.Record.Id, provider, stepUpChallenge); err != nil {
				return e.BadRequestError("Invalid or expired Google re-authentication challenge.", err)
			}
			if err := e.Next(); err != nil {
				return err
			}
			if err := store.ConfirmStepUpChallenge(e.Record.Id, provider, stepUpChallenge); err != nil {
				return e.BadRequestError("Invalid or expired Google re-authentication challenge.", err)
			}
			return nil
		}

		switch {
		case alreadyLinked && e.Record != nil:
			// Returning Google sign-in.
			return e.Next()

		case e.IsNewRecord:
			// Brand-new Google Account. has_cognos_password stays false (default);
			// password signup sets it true in EnforceCognosPasswordBoundaries.
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

// EnforceCognosPasswordBoundaries maintains the has_cognos_password boundary:
// password signup sets it, while OAuth-only Accounts cannot enter native
// password-dependent reset or email-change flows.
func EnforceCognosPasswordBoundaries(app core.App) {
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

	app.OnRecordRequestPasswordResetRequest("users").BindFunc(func(e *core.RecordRequestPasswordResetRequestEvent) error {
		if e.Record != nil && !e.Record.GetBool("has_cognos_password") {
			// Match PocketBase's neutral response for an unknown email so this
			// cannot be used to enumerate OAuth-only Accounts.
			return e.NoContent(http.StatusNoContent)
		}
		return e.Next()
	})

	app.OnRecordRequestEmailChangeRequest("users").BindFunc(func(e *core.RecordRequestEmailChangeRequestEvent) error {
		if e.Record != nil && !e.Record.GetBool("has_cognos_password") {
			return e.NoContent(http.StatusNoContent)
		}
		return e.Next()
	})

	app.OnRecordConfirmPasswordResetRequest("users").BindFunc(func(e *core.RecordConfirmPasswordResetRequestEvent) error {
		if e.Record == nil || !e.Record.GetBool("has_cognos_password") {
			return e.BadRequestError("Invalid or expired password reset token.", nil)
		}
		return e.Next()
	})
}

func exactExternalAuthExists(
	app core.App,
	record *core.Record,
	provider string,
	providerID string,
) (bool, error) {
	if record == nil || providerID == "" {
		return false, nil
	}

	externalAuth, err := app.FindFirstExternalAuthByExpr(dbx.HashExp{
		"collectionRef": record.Collection().Id,
		"recordRef":     record.Id,
		"provider":      provider,
		"providerId":    providerID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return externalAuth != nil, nil
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
