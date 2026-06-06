import { z } from 'zod';

import { KeyPair } from './key-pair';

/**
 * ConversationData is the decrypted data object of a conversation.
 */
export const ConversationData = z.object({
  title: z.string().trim(),
});
export type ConversationData = z.infer<typeof ConversationData>;

export interface ConversationRecord {
  id: string;
  created: string;
  updated: string;
  data: string;
  creator?: string;
  expiry_duration?: string;
}

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
