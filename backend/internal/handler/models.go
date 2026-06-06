package handler

import (
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

func ModelsGet() func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !auth.IsAuthenticated(e) {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		userTier := catalogue.NormalizePrivacyTier(e.Auth.GetString("privacy_tier"))
		preferredModelID := e.Auth.GetString("preferred_model_id")

		models := catalogue.ActiveModels()
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
