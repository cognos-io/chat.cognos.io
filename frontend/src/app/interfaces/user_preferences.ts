import { z } from 'zod';

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
