package handler

import (
	"context"
	"net/http"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

type modelResponse struct {
	catalogue.Model
	IsEligible          bool   `json:"is_eligible"`
	IneligibilityReason string `json:"ineligibility_reason,omitempty"`
}

type modelsResponse struct {
	PrivacyTier      catalogue.PrivacyTier `json:"privacy_tier"`
	PreferredModelID string                `json:"preferred_model_id,omitempty"`
	Models           []modelResponse       `json:"models"`
}

// publicModelName is the minimal, non-sensitive catalogue projection exposed to
// unauthenticated readers (e.g. the public shared-conversation page) so they
// can show a model's display name instead of its raw id.
type publicModelName struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type publicModelsResponse struct {
	Models []publicModelName `json:"models"`
}

// PublicModelsGet returns id→name for active models with no authentication.
// Only the id and display name are exposed — never pricing, tiers, or
// eligibility, which are user-specific.
func PublicModelsGet(catalogueService catalogue.Service) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		models, err := catalogueService.ActiveModels(context.Background())
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load models", err)
		}

		names := make([]publicModelName, 0, len(models))
		for _, model := range models {
			names = append(names, publicModelName{ID: model.ID, Name: model.Name})
		}

		return e.JSON(http.StatusOK, publicModelsResponse{Models: names})
	}
}

func ModelsGet(catalogueService catalogue.Service) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !auth.IsAuthenticated(e) {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		userTier := catalogue.NormalizePrivacyTier(e.Auth.GetString("privacy_tier"))
		preferredModelID := e.Auth.GetString("preferred_model_id")

		models, err := catalogueService.ActiveModels(context.Background())
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load models", err)
		}

		responseModels := make([]modelResponse, 0, len(models))
		for _, model := range models {
			isEligible := catalogue.IsEligibleForTier(userTier, model.PrivacyTier)
			responseModel := modelResponse{
				Model:      model,
				IsEligible: isEligible,
			}
			if !isEligible {
				responseModel.IneligibilityReason = "model privacy tier exceeds user privacy tier"
			}
			responseModels = append(responseModels, responseModel)
		}

		return e.JSON(http.StatusOK, modelsResponse{
			PrivacyTier:      userTier,
			PreferredModelID: preferredModelID,
			Models:           responseModels,
		})
	}
}
