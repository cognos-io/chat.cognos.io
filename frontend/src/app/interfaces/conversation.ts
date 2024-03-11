import { z } from 'zod';
import { Base64 } from 'js-base64';
import { KeyPair } from './key-pair';

/**
 * ConversationRecord is a record of a conversation in the PocketBase backend.
 */
export const ConversationRecord = z.object({
  id: z.string(),
  created: z.string().datetime(),
  updated: z.string().datetime(),
  data: z.string().refine(Base64.isValid), // base64 encrypted data
  creatorId: z.string().optional(), // may be null for some reason
});
export type ConversationRecord = z.infer<typeof ConversationRecord>;

/**
 * ConversationData is the decrypted data object of a conversation.
 */
export const ConversationData = z.object({
  title: z.string(),
});
export type ConversationData = z.infer<typeof ConversationData>;

/**
 * parseConversationData - takes a decrypted base64 string
 * and returns a ConversationData object.
 *
 * @param decryptedBase64Data
 * @returns
 */
export const parseConversationData = (
  decryptedBase64Data: Uint8Array
): ConversationData => {
  return ConversationData.parse(
    JSON.parse(Base64.fromUint8Array(decryptedBase64Data))
  );
};

/**
 * serializeConversationData - takes a ConversationData object
 * and returns a base64 encoded JSON representation.
 *
 * @param data
 * @returns
 */
export const serializeConversationData = (
  data: ConversationData
): Uint8Array => {
  return Base64.toUint8Array(JSON.stringify(ConversationData.parse(data)));
};

export interface Conversation {
  record: ConversationRecord;
  decryptedData: ConversationData;
  keyPair: KeyPair;
}
