/**
 * This file was @generated using pocketbase-typegen
 */
import type PocketBase from 'pocketbase';
import type { RecordService } from 'pocketbase';

export enum Collections {
  Agents = 'agents',
  ConversationPublicKeys = 'conversation_public_keys',
  ConversationSecretKeys = 'conversation_secret_keys',
  Conversations = 'conversations',
  Deleted = 'deleted',
  Idempotency = 'idempotency',
  Messages = 'messages',
  Models = 'models',
  UserKeyPairs = 'user_key_pairs',
  UserPreferences = 'user_preferences',
  Users = 'users',
}

// Alias types for improved usability
export type IsoDateString = string;
export type RecordIdString = string;
export type HTMLString = string;

// System fields
export type BaseSystemFields<T = never> = {
  id: RecordIdString;
  created: IsoDateString;
  updated: IsoDateString;
  collectionId: string;
  collectionName: Collections;
  expand?: T;
};

export type AuthSystemFields<T = never> = {
  email: string;
  emailVisibility: boolean;
  username: string;
  verified: boolean;
} & BaseSystemFields<T>;

// Record types for each collection

export type AgentsRecord = {
  description: string;
  name: string;
  slug: string;
};

export type ConversationPublicKeysRecord = {
  conversation: RecordIdString;
  public_key?: string;
};

export type ConversationSecretKeysRecord = {
  conversation: RecordIdString;
  secret_key?: string;
  user: RecordIdString;
};

export enum ConversationsExpiryDurationOptions {
  '24h' = '24h',
  '168h' = '168h',
  '2160h' = '2160h',
  '4320h' = '4320h',
}
export type ConversationsRecord = {
  creator?: RecordIdString;
  data: string;
  expiry_duration?: ConversationsExpiryDurationOptions;
};

export type DeletedRecord<Trecord = unknown> = {
  collection?: string;
  record?: null | Trecord;
};

export type IdempotencyRecord<Tbody = unknown> = {
  body?: null | Tbody;
  idempotency_key: string;
  status_code?: number;
  user?: RecordIdString;
};

export type MessagesRecord = {
  conversation: RecordIdString;
  data: string;
  expires?: IsoDateString;
  parent_message?: RecordIdString;
};

export enum ModelsGroupOptions {
  'Open AI' = 'Open AI',
  'Google' = 'Google',
  'Anthropic' = 'Anthropic',
  'Mistral' = 'Mistral',
  'Other' = 'Other',
}
export type ModelsRecord = {
  description: string;
  group: ModelsGroupOptions;
  name: string;
  slug: string;
};

export type UserKeyPairsRecord = {
  public_key: string;
  secret_key: string;
  user: RecordIdString;
};

export type UserPreferencesRecord = {
  data: string;
  user: RecordIdString;
};

export type UsersRecord = {
  avatar?: string;
  name?: string;
};

// Response types include system fields and match responses from the PocketBase API
export type AgentsResponse<Texpand = unknown> = Required<AgentsRecord> &
  BaseSystemFields<Texpand>;
export type ConversationPublicKeysResponse<Texpand = unknown> =
  Required<ConversationPublicKeysRecord> & BaseSystemFields<Texpand>;
export type ConversationSecretKeysResponse<Texpand = unknown> =
  Required<ConversationSecretKeysRecord> & BaseSystemFields<Texpand>;
export type ConversationsResponse<Texpand = unknown> = Required<ConversationsRecord> &
  BaseSystemFields<Texpand>;
export type DeletedResponse<Trecord = unknown, Texpand = unknown> = Required<
  DeletedRecord<Trecord>
> &
  BaseSystemFields<Texpand>;
export type IdempotencyResponse<Tbody = unknown, Texpand = unknown> = Required<
  IdempotencyRecord<Tbody>
> &
  BaseSystemFields<Texpand>;
export type MessagesResponse<Texpand = unknown> = Required<MessagesRecord> &
  BaseSystemFields<Texpand>;
export type ModelsResponse<Texpand = unknown> = Required<ModelsRecord> &
  BaseSystemFields<Texpand>;
export type UserKeyPairsResponse<Texpand = unknown> = Required<UserKeyPairsRecord> &
  BaseSystemFields<Texpand>;
export type UserPreferencesResponse<Texpand = unknown> =
  Required<UserPreferencesRecord> & BaseSystemFields<Texpand>;
export type UsersResponse<Texpand = unknown> = Required<UsersRecord> &
  AuthSystemFields<Texpand>;

// Types containing all Records and Responses, useful for creating typing helper functions

export type CollectionRecords = {
  agents: AgentsRecord;
  conversation_public_keys: ConversationPublicKeysRecord;
  conversation_secret_keys: ConversationSecretKeysRecord;
  conversations: ConversationsRecord;
  deleted: DeletedRecord;
  idempotency: IdempotencyRecord;
  messages: MessagesRecord;
  models: ModelsRecord;
  user_key_pairs: UserKeyPairsRecord;
  user_preferences: UserPreferencesRecord;
  users: UsersRecord;
};

export type CollectionResponses = {
  agents: AgentsResponse;
  conversation_public_keys: ConversationPublicKeysResponse;
  conversation_secret_keys: ConversationSecretKeysResponse;
  conversations: ConversationsResponse;
  deleted: DeletedResponse;
  idempotency: IdempotencyResponse;
  messages: MessagesResponse;
  models: ModelsResponse;
  user_key_pairs: UserKeyPairsResponse;
  user_preferences: UserPreferencesResponse;
  users: UsersResponse;
};

// Type for usage with type asserted PocketBase instance
// https://github.com/pocketbase/js-sdk#specify-typescript-definitions

export type TypedPocketBase = PocketBase & {
  collection(idOrName: 'agents'): RecordService<AgentsResponse>;
  collection(
    idOrName: 'conversation_public_keys',
  ): RecordService<ConversationPublicKeysResponse>;
  collection(
    idOrName: 'conversation_secret_keys',
  ): RecordService<ConversationSecretKeysResponse>;
  collection(idOrName: 'conversations'): RecordService<ConversationsResponse>;
  collection(idOrName: 'deleted'): RecordService<DeletedResponse>;
  collection(idOrName: 'idempotency'): RecordService<IdempotencyResponse>;
  collection(idOrName: 'messages'): RecordService<MessagesResponse>;
  collection(idOrName: 'models'): RecordService<ModelsResponse>;
  collection(idOrName: 'user_key_pairs'): RecordService<UserKeyPairsResponse>;
  collection(idOrName: 'user_preferences'): RecordService<UserPreferencesResponse>;
  collection(idOrName: 'users'): RecordService<UsersResponse>;
};
