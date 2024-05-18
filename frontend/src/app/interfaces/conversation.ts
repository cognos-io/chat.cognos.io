import { Base64 } from 'js-base64';
import { z } from 'zod';

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
  title: z.string().trim(),
});
export type ConversationData = z.infer<typeof ConversationData>;

/**
 * parseConversationData - takes a decrypted string
 * and returns a ConversationData object.
 *
 * @param decryptedData (Uint8Array) JSON string
 * @returns
 */
export const parseConversationData = (decryptedData: Uint8Array): ConversationData => {
  const dataString = new TextDecoder().decode(decryptedData);
  return ConversationData.parse(JSON.parse(dataString));
};

/**
 * serializeConversationData - takes a ConversationData object
 * and returns a binary representation of the object string.
 *
 * @param data (ConversationData) object to serialize
 * @returns (Uint8Array) encoded JSON representation
 */
export const serializeConversationData = (data: ConversationData): Uint8Array => {
  const serialized = JSON.stringify(ConversationData.parse(data));
  return new TextEncoder().encode(serialized);
};

export interface Conversation {
  record: ConversationRecord;
  decryptedData: ConversationData;
  keyPair: KeyPair;
}
