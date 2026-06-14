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

export const sortConversationsByUpdated = (
  conversations: Conversation[],
): Conversation[] => {
  return [...conversations].sort((a, b) =>
    b.record.updated.localeCompare(a.record.updated),
  );
};

export const partitionConversationsByPinned = (
  conversations: Conversation[],
  pinnedConversationIds: readonly string[],
): { pinned: Conversation[]; recent: Conversation[] } => {
  const byId = new Map(
    conversations.map((conversation) => [conversation.record.id, conversation]),
  );
  const pinnedSet = new Set(pinnedConversationIds);

  const pinned = pinnedConversationIds
    .map((id) => byId.get(id))
    .filter((conversation): conversation is Conversation => conversation !== undefined);

  const recent = sortConversationsByUpdated(
    conversations.filter((conversation) => !pinnedSet.has(conversation.record.id)),
  );

  return { pinned, recent };
};
