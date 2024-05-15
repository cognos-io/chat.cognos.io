package permissions

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/models"
)

type PermissionsRepo interface {
	// HasViewPermission checks if a user has permission to access a record
	// referred to by it's ID.
	// If it does it returns true, and the record itself for convenience
	HasViewPermission(
		info *models.RequestInfo,
		collectionName, recordID string,
	) (bool, *models.Record, error)
}

type PocketBasePermissionsRepo struct {
	app core.App
}

func (r *PocketBasePermissionsRepo) HasViewPermission(
	info *models.RequestInfo,
	collectionName, recordID string,
) (bool, *models.Record, error) {
	record, err := r.app.Dao().FindRecordById(collectionName, recordID)
	if err != nil {
		return false, nil, err
	}
	canAccess, err := r.app.Dao().
		CanAccessRecord(record, info, record.Collection().ViewRule)

	return canAccess, record, err
}

func NewPocketBasePermissionsRepo(app core.App) *PocketBasePermissionsRepo {
	return &PocketBasePermissionsRepo{
		app: app,
	}
}
