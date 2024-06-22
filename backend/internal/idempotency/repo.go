package idempotency

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/forms"
	"github.com/pocketbase/pocketbase/models"
)

// IdempotencyRepo keeps track of idempotent requests to avoid duplicate processing.
// It works by storing the response of a request and the status code in a database
// for a given user and idempotency key. When a new request comes in with the same
// user and idempotency key, the repo can check if the request has already been
// processed and return the response and status code.
// This matches similar functionality in the Stripe API:
// https://docs.stripe.com/api/idempotent_requests
type IdempotencyRepo interface {
	SaveIdempotentRequest(
		userID, idempotencyKey string,
		statusCode int,
		responseBodyJSON []byte,
	) error
	CheckForIdempotentRequest(
		userID, idempotencyKey string,
	) (ok bool, statusCode int, responseBodyJSON []byte)
}

type PocketBaseIdempotencyRepo struct {
	app core.App
}

func (r *PocketBaseIdempotencyRepo) SaveIdempotentRequest(
	userID, idempotencyKey string,
	statusCode int,
	responseBodyJSON []byte,
) error {
	const collectionName = "idempotency"

	collection, err := r.app.Dao().FindCollectionByNameOrId(collectionName)
	if err != nil {
		return err
	}

	record := models.NewRecord(collection)

	form := forms.NewRecordUpsert(r.app, record)

	err = form.LoadData(map[string]any{
		"user":            userID,
		"idempotency_key": idempotencyKey,
		"status_code":     statusCode,
		"body":            responseBodyJSON,
	})
	if err != nil {
		return err
	}

	return form.Submit()
}

func (r *PocketBaseIdempotencyRepo) CheckForIdempotentRequest(
	userID, idempotencyKey string,
) (ok bool, statusCode int, responseBodyJSON []byte) {
	const collectionName = "idempotency"

	records, err := r.app.Dao().FindRecordsByFilter(collectionName,
		"user = {:user_id} AND idempotency_key = {:idempotency_key}",
		"-updated",
		1,
		0,
		dbx.Params{"user_id": userID, "idempotency_key": idempotencyKey},
	)
	if err != nil {
		return false, 0, nil
	}

	if len(records) == 0 {
		return false, 0, nil
	}

	record := records[0]
	statusCode = record.GetInt("status_code")
	responseBodyJSON, ok = record.Get("response_body_json").([]byte)
	return ok, statusCode, responseBodyJSON
}

func NewPocketBaseIdempotencyRepo(app core.App) *PocketBaseIdempotencyRepo {
	return &PocketBaseIdempotencyRepo{app: app}
}
