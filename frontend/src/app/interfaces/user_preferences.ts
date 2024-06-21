import { z } from 'zod';

export const UserPreferencesData = z.object({
  pinnedConversations: z.array(z.string()),
});
export type UserPreferencesData = z.infer<typeof UserPreferencesData>;

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
export const serializeUserPreferencesData = (data: UserPreferencesData): Uint8Array => {
  const serialized = JSON.stringify(UserPreferencesData.parse(data));
  return new TextEncoder().encode(serialized);
};
