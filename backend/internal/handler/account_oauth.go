package handler

import (
	"errors"
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/oauth"
)

// OAuthParams bundles dependencies for Google OAuth account endpoints.
type OAuthParams struct {
	App   core.App
	Store *oauth.Store
}

type accountAuthMethodsResponse struct {
	HasPassword bool     `json:"hasPassword"`
	Providers   []string `json:"providers"`
}

// AccountAuthMethods reports whether the Account has a Cognos password and
// which OAuth providers are linked.
func AccountAuthMethods(params OAuthParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		userRecord, err := params.App.FindRecordById("users", user.ID)
		if err != nil {
			return apis.NewNotFoundError("User not found", err)
		}

		providers := make([]string, 0)
		ext, err := params.App.FindAllExternalAuthsByRecord(userRecord)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load auth methods", err)
		}
		for _, ea := range ext {
			providers = append(providers, ea.Provider())
		}

		return e.JSON(http.StatusOK, accountAuthMethodsResponse{
			HasPassword: userRecord.GetBool("has_cognos_password"),
			Providers:   providers,
		})
	}
}

type oauthLinkIntentRequest struct {
	Password string `json:"password"`
	Provider string `json:"provider"`
}

type oauthLinkIntentResponse struct {
	LinkIntentId string `json:"linkIntentId"`
}

// AccountOAuthLinkIntent proves the Cognos password and returns a one-time
// intent for authWithOAuth2 createData (cognosLinkIntent).
func AccountOAuthLinkIntent(params OAuthParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		userRecord, err := params.App.FindRecordById("users", user.ID)
		if err != nil {
			return apis.NewNotFoundError("User not found", err)
		}
		if !userRecord.GetBool("has_cognos_password") {
			return apis.NewBadRequestError("This account has no Cognos password to confirm", nil)
		}

		var req oauthLinkIntentRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		provider := req.Provider
		if provider == "" {
			provider = oauth.ProviderGoogle
		}
		if provider != oauth.ProviderGoogle {
			return apis.NewBadRequestError("Unsupported provider", nil)
		}
		if !userRecord.ValidatePassword(req.Password) {
			return apis.NewBadRequestError("Incorrect password", nil)
		}

		raw, err := params.Store.CreateLinkIntent(user.ID, provider)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to create link intent", err)
		}
		return e.JSON(http.StatusOK, oauthLinkIntentResponse{LinkIntentId: raw})
	}
}

type oauthStepUpBeginResponse struct {
	ChallengeId string `json:"challengeId"`
}

// AccountOAuthStepUpBegin starts Google re-auth for OAuth-only account delete.
func AccountOAuthStepUpBegin(params OAuthParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		userRecord, err := params.App.FindRecordById("users", user.ID)
		if err != nil {
			return apis.NewNotFoundError("User not found", err)
		}
		if userRecord.GetBool("has_cognos_password") {
			return apis.NewBadRequestError("Use your password to delete this account", nil)
		}

		ext, err := params.App.FindAllExternalAuthsByRecord(userRecord)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load auth methods", err)
		}
		hasGoogle := false
		for _, ea := range ext {
			if ea.Provider() == oauth.ProviderGoogle {
				hasGoogle = true
				break
			}
		}
		if !hasGoogle {
			return apis.NewBadRequestError("Google is not connected to this account", nil)
		}

		raw, err := params.Store.CreateStepUpChallenge(user.ID, oauth.ProviderGoogle)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to create challenge", err)
		}
		return e.JSON(http.StatusOK, oauthStepUpBeginResponse{ChallengeId: raw})
	}
}

type oauthStepUpCompleteRequest struct {
	ChallengeId string `json:"challengeId"`
}

type oauthStepUpCompleteResponse struct {
	OAuthStepUpId string `json:"oauthStepUpId"`
}

// AccountOAuthStepUpComplete exchanges a Google-confirmed challenge for a
// one-time oauthStepUpId usable on DELETE /account.
func AccountOAuthStepUpComplete(params OAuthParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		var req oauthStepUpCompleteRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		raw, err := params.Store.CompleteStepUpChallenge(user.ID, oauth.ProviderGoogle, req.ChallengeId)
		if err != nil {
			if errors.Is(err, oauth.ErrNotFound) {
				return apis.NewBadRequestError("Invalid or incomplete Google re-authentication", nil)
			}
			return apis.NewApiError(http.StatusInternalServerError, "Failed to complete step-up", err)
		}
		return e.JSON(http.StatusOK, oauthStepUpCompleteResponse{OAuthStepUpId: raw})
	}
}
