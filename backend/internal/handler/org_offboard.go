package handler

import (
	"errors"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/organisations"
	"github.com/cognos-io/chat.cognos.io/backend/internal/projectparticipants"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// errLastProjectAdmin is returned when offboarding would leave an Organisation
// Project without an Admin who can finish key rotation.
var errLastProjectAdmin = errors.New("last project admin")

// collectOffboardProjects returns Organisation Project IDs where targetUserID
// is an active participant and another Admin remains. If the target is the
// sole Admin on any Project they can access, it returns errLastProjectAdmin.
func collectOffboardProjects(
	app core.App,
	orgRepo organisations.Repo,
	orgID, targetUserID string,
) ([]string, error) {
	projectIDs, err := orgRepo.OrgProjectIDs(orgID)
	if err != nil {
		return nil, err
	}

	affected := make([]string, 0, len(projectIDs))
	projectRepo := projectparticipants.NewPocketBaseRepo(app)
	for _, projectID := range projectIDs {
		participants, err := projectRepo.ListActive(projectID)
		if err != nil {
			return nil, err
		}
		targetHasAccess := false
		remainingAdmin := false
		for _, participant := range participants {
			if participant.UserID == targetUserID {
				targetHasAccess = true
				continue
			}
			if participant.Role == projectparticipants.RoleAdmin {
				remainingAdmin = true
			}
		}
		if !targetHasAccess {
			continue
		}
		if !remainingAdmin {
			return nil, errLastProjectAdmin
		}
		affected = append(affected, projectID)
	}
	return affected, nil
}

// applyOffboardInTx soft-revokes the membership, revokes Project participation
// on affected projects, marks those projects rotation_pending, and updates
// pending seat quantity. Caller must already hold a write transaction.
func applyOffboardInTx(
	txApp core.App,
	orgID, targetUserID string,
	affectedProjectIDs []string,
) error {
	membership, err := txApp.FindFirstRecordByFilter(
		organisations.MembershipsCollectionName,
		"organisation = {:org} && user = {:user} && removed_at = ''",
		dbx.Params{"org": orgID, "user": targetUserID},
	)
	if err != nil || membership == nil {
		return errors.New("membership not found")
	}
	membership.Set("removed_at", time.Now().UTC())
	if err := txApp.Save(membership); err != nil {
		return err
	}

	for _, pid := range affectedProjectIDs {
		participant, err := txApp.FindFirstRecordByFilter(
			projectparticipants.CollectionName,
			"project = {:project} && user = {:user} && removed_at = ''",
			dbx.Params{"project": pid, "user": targetUserID},
		)
		if err == nil && participant != nil {
			participant.Set("removed_at", time.Now().UTC())
			if err := txApp.Save(participant); err != nil {
				return err
			}
			project, err := txApp.FindRecordById("projects", pid)
			if err != nil {
				return err
			}
			project.Set("rotation_pending", true)
			if err := txApp.Save(project); err != nil {
				return err
			}
		}
	}

	billingRecord, err := txApp.FindFirstRecordByFilter(
		"org_billing",
		"organisation = {:org}",
		dbx.Params{"org": orgID},
	)
	if err == nil && billingRecord != nil {
		remaining, countErr := txApp.FindRecordsByFilter(
			organisations.MembershipsCollectionName,
			"organisation = {:org} && removed_at = ''",
			"",
			0,
			0,
			dbx.Params{"org": orgID},
		)
		if countErr != nil {
			return countErr
		}
		nextBilled := billing.BilledOrgSeatQuantity(int64(len(remaining)))
		billingRecord.Set("pending_seat_quantity", int(nextBilled))
		if err := txApp.Save(billingRecord); err != nil {
			return err
		}
	}

	return nil
}
