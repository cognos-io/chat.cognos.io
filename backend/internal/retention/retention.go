// Package retention resolves and enforces conversation auto-delete windows.
//
// Two plaintext settings drive it: an account-level default
// (users.default_retention_days) and an optional per-conversation override
// (conversations.retention_days). The effective window is measured from a
// conversation's last activity; when it elapses, the conversation and its
// cascade (messages, keys, participants, shares, attachments) are permanently
// deleted by the background job. Never deletes eagerly: any ambiguity resolves
// to "keep".
package retention

import "time"

// Sentinel values shared with the API layer and the migrations. See
// db/migrations/1760000068_* and _069_* for the on-disk contract.
const (
	// ConversationInherit means the conversation uses its creator's account
	// default. It is the zero value, so a fresh conversation inherits.
	ConversationInherit = 0
	// ConversationNever is the explicit per-conversation "never delete"
	// override, taking precedence over an opted-in account default.
	ConversationNever = -1

	// AccountNever is the account default meaning "never delete" — also the
	// zero value, so the product default is never.
	AccountNever = 0

	// MaxRetentionDays bounds the stored window so date arithmetic cannot
	// overflow and mirrors the number field's `max` in the migrations.
	MaxRetentionDays = 3650
)

// EffectiveRetentionDays resolves the window (in days) that actually applies to
// a conversation, given its own retention setting and the creator's account
// default. A return of 0 means "never delete". A positive return is the number
// of days after last activity at which the conversation becomes eligible for
// deletion.
//
// Resolution order:
//   - conversation override > 0 → that many days (wins over the account default)
//   - conversation override < 0 → never (explicit ConversationNever)
//   - conversation inherit (0)  → account default (which itself may be never)
func EffectiveRetentionDays(conversationDays, accountDefaultDays int) int {
	switch {
	case conversationDays > 0:
		return conversationDays
	case conversationDays < 0: // ConversationNever
		return 0
	default: // ConversationInherit
		if accountDefaultDays > 0 {
			return accountDefaultDays
		}
		return 0
	}
}

// Elapsed reports whether a conversation whose effective window is days (from
// EffectiveRetentionDays) is now eligible for deletion, measured from its last
// activity. days <= 0 ("never") is never elapsed. A zero lastActivity time is
// treated as "never" too, so a row we cannot date is never deleted.
func Elapsed(lastActivity time.Time, days int, now time.Time) bool {
	if days <= 0 || lastActivity.IsZero() {
		return false
	}
	cutoff := lastActivity.Add(time.Duration(days) * 24 * time.Hour)
	return now.After(cutoff)
}
