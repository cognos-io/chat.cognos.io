import { z } from 'zod';

import { parseBackendDate } from '@app/utils/timestamp';

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
  last_activity_at?: string;
  data: string;
  creator?: string;
  expiry_duration?: string;
  // When set, the conversation belongs to a project: it is gated by project
  // membership and kept out of the main sidebar list (it shows under the
  // project instead). Its key is wrapped by the project content key rather
  // than per-participant.
  project?: string;
  // Current-generation key material embedded by the conversation-list endpoint
  // so the client decrypts without a per-conversation key round-trip. Present
  // only on the list response (not on create/update responses); the loader
  // falls back to the per-conversation key endpoints when any are absent.
  public_key?: string;
  public_key_signature?: string;
  wrapped_secret_key?: string;
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

// activityAtMs parses the timestamp used for sidebar ordering. Prefer the
// explicit activity timestamp; fall back to PocketBase's generic row timestamp
// for older records/API responses.
//
// Conversations carry mixed timestamp formats — the backend serialises
// "2006-01-02 15:04:05.000Z" (space) while an optimistic client bump writes
// ISO-8601 "…T…". Comparing the raw strings would order by the character at
// the date/time boundary ('T' vs ' ') before the actual time, so we compare
// parsed instants instead.
const activityAtMs = (conversation: Conversation): number => {
  const time = parseBackendDate(
    conversation.record.last_activity_at || conversation.record.updated,
  ).getTime();
  return Number.isNaN(time) ? 0 : time;
};

export const sortConversationsByUpdated = (
  conversations: Conversation[],
): Conversation[] => {
  return [...conversations].sort((a, b) => activityAtMs(b) - activityAtMs(a));
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
