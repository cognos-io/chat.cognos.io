// Auto-delete (retention) wire-value mapping shared by the account default
// selector and the per-conversation override. The backend speaks integers:
//
//   account default (`users.default_retention_days`)
//     0  → never delete (also the value when unset)
//     7  → delete 7 days after last activity
//     30 → delete 30 days after last activity
//
//   per-conversation override (PATCH .../retention { retention_days })
//     0  → inherit the account default
//    -1  → never delete (explicitly, regardless of the account default)
//     7  → delete after 7 days
//     30 → delete after 30 days
//
// `cog-segmented-control` works in string values, so the option value is just
// the stringified integer; `retentionSegmentValue`/`parseRetentionSegmentValue`
// are the (pinned) bridge between the two.

export interface RetentionOption {
  /** Wire value sent to the backend. */
  days: number;
  /** i18n key suffix under `retention.options.*`. */
  labelKey: string;
}

// Account default: 0 means "never" (there is no inherit at account level).
export const ACCOUNT_RETENTION_OPTIONS: readonly RetentionOption[] = [
  { days: 0, labelKey: 'never' },
  { days: 7, labelKey: 'sevenDays' },
  { days: 30, labelKey: 'thirtyDays' },
];

// Per-conversation override: 0 inherits the account default, -1 is an explicit
// never.
export const CONVERSATION_RETENTION_OPTIONS: readonly RetentionOption[] = [
  { days: 0, labelKey: 'inherit' },
  { days: -1, labelKey: 'never' },
  { days: 7, labelKey: 'sevenDays' },
  { days: 30, labelKey: 'thirtyDays' },
];

// The segment value is the stringified wire integer. Keeping this explicit (and
// tested) means a mismatched control value can never silently PATCH the wrong
// retention.
export const retentionSegmentValue = (days: number): string => String(days);

export const parseRetentionSegmentValue = (value: string): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : 0;
};

// Coerce a stored/returned value onto a known account option, else fall back to
// 0 (never) — so an unexpected value never leaves the control with no active
// segment.
export const normalizeAccountRetention = (days: number | undefined | null): number =>
  ACCOUNT_RETENTION_OPTIONS.some((option) => option.days === days)
    ? (days as number)
    : 0;

// Coerce a stored/returned value onto a known conversation option, else fall
// back to 0 (inherit).
export const normalizeConversationRetention = (
  days: number | undefined | null,
): number =>
  CONVERSATION_RETENTION_OPTIONS.some((option) => option.days === days)
    ? (days as number)
    : 0;

// The `retention.options.*` label key for a normalised conversation value.
export const conversationRetentionLabelKey = (days: number): string =>
  CONVERSATION_RETENTION_OPTIONS.find(
    (option) => option.days === normalizeConversationRetention(days),
  )?.labelKey ?? 'inherit';

// effectiveRetentionDays resolves what actually happens to a conversation:
// the per-conversation override unless it inherits (0), in which case the
// account default applies. Returned in ACCOUNT semantics so a single value
// describes the outcome:
//
//   0  → never delete (off)
//   7  → delete 7 days after last activity
//   30 → delete 30 days after last activity
//
// This is the truth the per-answer privacy receipt and the privacy panel show,
// so both agree without each re-deriving the inherit/never rules.
export const effectiveRetentionDays = (
  conversationDays: number | undefined | null,
  accountDefaultDays: number | undefined | null,
): number => {
  const conversation = normalizeConversationRetention(conversationDays);
  if (conversation === -1) {
    return 0; // explicit "never", regardless of the account default
  }
  if (conversation === 0) {
    return normalizeAccountRetention(accountDefaultDays); // inherit
  }
  return conversation; // 7 or 30
};
