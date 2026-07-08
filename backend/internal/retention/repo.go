package retention

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/list"
	"github.com/pocketbase/pocketbase/tools/types"
)

// PocketBaseRepo finds and permanently deletes conversations whose effective
// retention window has elapsed. It reads the two plaintext retention settings
// (users.default_retention_days, conversations.retention_days) and never
// touches message plaintext.
type PocketBaseRepo struct {
	app core.App
}

func NewPocketBaseRepo(app core.App) *PocketBaseRepo {
	return &PocketBaseRepo{app: app}
}

// conversationRow is the minimal candidate projection: enough to resolve the
// effective window and its last-activity anchor without loading ciphertext.
// The conversations collection has no autodate created/updated columns, so
// last_activity_at (backfilled by migration and stamped on create + activity)
// is the sole anchor.
type conversationRow struct {
	ID             string `db:"id"`
	Creator        string `db:"creator"`
	RetentionDays  int    `db:"retention_days"`
	LastActivityAt string `db:"last_activity_at"`
}

// FindExpiredConversationIDs returns the ids of conversations that are eligible
// for deletion at now. It is deliberately conservative: it only considers
// conversations with an explicit positive override, or inheriting conversations
// whose creator has opted into an account default — every other conversation
// (inherit + account-never, or an explicit never override) is skipped entirely,
// so the common "nobody opted in" case scans nothing.
func (r *PocketBaseRepo) FindExpiredConversationIDs(now time.Time) ([]string, error) {
	// Creators who opted into an account default (small: only opted-in users).
	optedIn, err := r.accountDefaults()
	if err != nil {
		return nil, err
	}

	// Candidate set: explicit positive overrides, plus inheriting rows whose
	// creator opted in. Explicit "never" (-1) rows are excluded by both arms.
	conditions := []dbx.Expression{dbx.NewExp("retention_days > 0")}
	if len(optedIn) > 0 {
		creatorIDs := make([]string, 0, len(optedIn))
		for id := range optedIn {
			creatorIDs = append(creatorIDs, id)
		}
		conditions = append(conditions, dbx.And(
			dbx.NewExp("COALESCE(retention_days, 0) = 0"),
			dbx.In("creator", list.ToInterfaceSlice[string](creatorIDs)...),
		))
	}

	var rows []conversationRow
	if err := r.app.DB().
		Select("id", "creator", "retention_days", "last_activity_at").
		From("conversations").
		Where(dbx.Or(conditions...)).
		All(&rows); err != nil {
		return nil, err
	}

	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		days := EffectiveRetentionDays(row.RetentionDays, optedIn[row.Creator])
		if days <= 0 {
			continue
		}
		if Elapsed(activityAnchor(row), days, now) {
			ids = append(ids, row.ID)
		}
	}
	return ids, nil
}

// DeleteConversations permanently deletes each conversation via the ORM so the
// relation cascade (messages, keys, participants, shares, attachments) runs,
// exactly like a user-initiated delete. Deletes are independent: a single
// failure does not abort the sweep. Returns the number actually deleted and the
// first error encountered (if any) for the caller to log — never the ids.
func (r *PocketBaseRepo) DeleteConversations(ids []string) (int, error) {
	var firstErr error
	deleted := 0
	for _, id := range ids {
		record, err := r.app.FindRecordById("conversations", id)
		if err != nil {
			// Already gone (e.g. cascaded or user-deleted between find and
			// delete) — nothing to do.
			continue
		}
		if err := r.app.Delete(record); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		deleted++
	}
	return deleted, firstErr
}

// accountDefaults returns creatorID → positive default_retention_days for every
// user who has opted into auto-delete. Users at the default (never / 0) are
// omitted so the candidate query stays tight.
func (r *PocketBaseRepo) accountDefaults() (map[string]int, error) {
	var rows []struct {
		ID   string `db:"id"`
		Days int    `db:"default_retention_days"`
	}
	if err := r.app.DB().
		Select("id", "default_retention_days").
		From("users").
		Where(dbx.NewExp("COALESCE(default_retention_days, 0) > 0")).
		All(&rows); err != nil {
		return nil, err
	}

	defaults := make(map[string]int, len(rows))
	for _, row := range rows {
		defaults[row.ID] = row.Days
	}
	return defaults, nil
}

// activityAnchor is the timestamp the retention window is measured from:
// last_activity_at (stamped on create and every user-visible activity, and
// backfilled by migration for pre-existing rows). Returns the zero time when it
// cannot be parsed, which Elapsed treats as "never delete" — so an undateable
// conversation is always kept.
func activityAnchor(row conversationRow) time.Time {
	if row.LastActivityAt == "" {
		return time.Time{}
	}
	if dt, err := types.ParseDateTime(row.LastActivityAt); err == nil && !dt.IsZero() {
		return dt.Time()
	}
	return time.Time{}
}
