import { z } from 'zod';

export const ModelQuickFilter = z.enum([
  'pinned',
  'recommended',
  'fast',
  'powerful',
  'low_cost',
  'reasoning',
  'web_search',
  'image',
  'vision',
  'long_context',
]);
export type ModelQuickFilter = z.infer<typeof ModelQuickFilter>;

export const UserPreferencesData = z.object({
  pinnedConversations: z.array(z.string()),
  pinnedModels: z.array(z.string()).default([]),
  // Persona state is kept here rather than on the personas collection so it
  // also covers Cognos-provided personas (which have no per-user record) and
  // never leaks which personas a user pins or favours.
  pinnedPersonas: z.array(z.string()).default([]),
  recentPersonas: z.array(z.string()).default([]),
  defaultPersonaId: z.string().default(''),
  // The user's default model and persona live here (encrypted), so this object
  // is the single source of truth wherever a default is set (chat or settings).
  defaultModelId: z.string().default(''),
  // Browser PII redaction is on by default (secure by default). When the user
  // turns it off it stays off for future messages until re-enabled.
  redactionEnabled: z.boolean().default(true),
  // Per-model reasoning-effort the user last chose, keyed by model id. Remembered
  // so reselecting a model restores the chosen intensity. Values are validated
  // against the model's declared options at use time, so stale entries are safe.
  modelReasoningEfforts: z.record(z.string(), z.string()).default({}),
  // Most-recently-used model ids, most-recent-first, de-duplicated and capped.
  // Surfaces a "Recent" group in the selector. Encrypted like the rest of this
  // payload — model usage history never lives in plaintext (spec §6.3/§6.4).
  recentModels: z.array(z.string()).default([]),
  // Model ids the user has hidden from the normal selector. Managed in account
  // settings. Unknown ids are ignored at read time, so stale entries are safe.
  hiddenModels: z.array(z.string()).default([]),
  // The user's preferred model per capability context (e.g. "image_generation"),
  // keyed by context. The plain-chat ("text") default stays in `defaultModelId`,
  // so this only holds tool contexts and existing payloads need no migration.
  // Toggling a composer tool restores that context's model; unknown/ineligible
  // ids are ignored at read time (spec docs/specs/tool-aware-model-selection.md §5).
  toolModelDefaults: z.record(z.string(), z.string()).default({}),
  // Last quick filter chosen in the model explorer. null means no filter, and
  // is intentionally remembered so the composer/settings do not re-enable
  // Recommended on the user's next visit.
  modelQuickFilter: ModelQuickFilter.nullable().default(null),
});
export type UserPreferencesData = z.infer<typeof UserPreferencesData>;

export const emptyPreferences: UserPreferencesData = {
  pinnedConversations: [],
  pinnedModels: [],
  pinnedPersonas: [],
  recentPersonas: [],
  defaultPersonaId: '',
  defaultModelId: '',
  redactionEnabled: true,
  modelReasoningEfforts: {},
  recentModels: [],
  hiddenModels: [],
  toolModelDefaults: {},
  modelQuickFilter: null,
};

/**
 * parseUserPreferencesData - takes a decrypted string
 * and returns a UserPreferencesData object.
 *
 * @param decryptedData (Uint8Array) JSON string
 * @returns (UserPreferencesData) object
 */
export const parseUserPreferencesData = (
  decryptedData: Uint8Array,
): UserPreferencesData => {
  const dataString = new TextDecoder().decode(decryptedData);
  return UserPreferencesData.parse(JSON.parse(dataString));
};

/**
 * serializeUserPreferencesData - takes a UserPreferencesData object
 * and returns a binary representation of the object string.
 *
 * @param data (UserPreferencesData) object to serialize
 * @returns (Uint8Array) encoded JSON representation
 */
export const serializeUserPreferencesData = (
  data: z.input<typeof UserPreferencesData>,
): Uint8Array => {
  const serialized = JSON.stringify(UserPreferencesData.parse(data));
  return new TextEncoder().encode(serialized);
};
