package hooks

import (
	"slices"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	deletedCollectionName         = "deleted"
	deletedRecordCleanupBatchSize = 500
)

var softDeleteExcludedCollections = []string{
	deletedCollectionName,
	"conversation_public_keys",
	"conversation_secret_keys",
	"user_key_pairs",
	// Removing a library file should erase it immediately: the sealed manifest
	// holds per-file keys (sealed to the owner), so a 30-day retention snapshot
	// would needlessly extend the lifetime of that key material. The ciphertext
	// bytes are removed with the record regardless (docs/business_processes/attachment-processing.md).
	"user_attachments",
	// MFA material is auth material: a deleted TOTP seed, recovery code, auth
	// session, or trusted-device token must disappear at once, never linger in a
	// retention snapshot (docs/business_processes/mfa-login.md).
	"user_mfa_totp",
	"mfa_auth_sessions",
	"mfa_recovery_codes",
	"mfa_trusted_devices",
}

func ShouldCopyDeletedRecord(collectionName string) bool {
	return !slices.Contains(softDeleteExcludedCollections, collectionName)
}

type DeletedRecordRepo interface {
	DeleteCreatedBefore(cutoff time.Time) error
}

type PocketBaseDeletedRecordRepo struct {
	app        core.App
	collection *core.Collection
}

func NewPocketBaseDeletedRecordRepo(app core.App) *PocketBaseDeletedRecordRepo {
	collection, err := app.FindCollectionByNameOrId(deletedCollectionName)
	if err != nil {
		panic(err)
	}

	return &PocketBaseDeletedRecordRepo{
		app:        app,
		collection: collection,
	}
}

func (r *PocketBaseDeletedRecordRepo) DeleteCreatedBefore(cutoff time.Time) error {
	cutoff = cutoff.UTC()

	for {
		records, err := r.app.FindRecordsByFilter(
			r.collection.Name,
			"deleted_at != '' && deleted_at < {:cutoff}",
			"",
			deletedRecordCleanupBatchSize,
			0,
			dbx.Params{"cutoff": cutoff},
		)
		if err != nil {
			return err
		}

		if len(records) == 0 {
			return nil
		}

		for _, record := range records {
			if err := r.app.Delete(record); err != nil {
				return err
			}
		}

		if len(records) < deletedRecordCleanupBatchSize {
			return nil
		}
	}
}
