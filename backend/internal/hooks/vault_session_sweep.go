package hooks

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	vaultSessionCollectionName = "vault_session_wrap_keys"
	vaultSessionSweepBatchSize = 500
)

// VaultSessionWrapKeyRepo sweeps stale persistent-session wrap keys.
type VaultSessionWrapKeyRepo interface {
	DeleteIdleBefore(cutoff time.Time) error
}

type PocketBaseVaultSessionWrapKeyRepo struct {
	app        core.App
	collection *core.Collection
}

func NewPocketBaseVaultSessionWrapKeyRepo(app core.App) *PocketBaseVaultSessionWrapKeyRepo {
	collection, err := app.FindCollectionByNameOrId(vaultSessionCollectionName)
	if err != nil {
		panic(err)
	}

	return &PocketBaseVaultSessionWrapKeyRepo{
		app:        app,
		collection: collection,
	}
}

// DeleteIdleBefore removes wrap keys whose last_used_at is older than cutoff.
// A wrap key is read/written every time the persistent session is used, so an
// old last_used_at means the device has been idle and its server-side unlock
// half should be revoked, forcing a fresh Account Key unlock next time.
func (r *PocketBaseVaultSessionWrapKeyRepo) DeleteIdleBefore(cutoff time.Time) error {
	cutoff = cutoff.UTC()

	for {
		records, err := r.app.FindRecordsByFilter(
			r.collection.Name,
			"last_used_at != '' && last_used_at < {:cutoff}",
			"",
			vaultSessionSweepBatchSize,
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

		if len(records) < vaultSessionSweepBatchSize {
			return nil
		}
	}
}
