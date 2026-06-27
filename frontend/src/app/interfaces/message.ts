import { z } from 'zod';

export const MessageDataVersion = z.enum(['1']);
export type MessageDataVersion = z.infer<typeof MessageDataVersion>;

/**
 * MessageAttachment is the decrypted metadata for an encrypted attachment (e.g.
 * a generated image). The ciphertext lives in the message record's protected
 * `attachment` file; this carries only what the client needs to fetch and
 * decrypt it. Mirrors MessageAttachment in the backend.
 */
export const MessageAttachment = z.object({
  kind: z.string(), // e.g. "generated_image" or "user_upload"
  mime_type: z.string(),
  // base64(SealAnonymous(conversationPublicKey, fileSymKey)) — unsealed with the
  // conversation secret key to recover the symmetric key that decrypts the file.
  // Present for generated images; absent for user uploads, whose keys live in the
  // encrypted conversation_attachments manifest (backend omits it via omitempty).
  sealed_key: z.string().optional(),
  // References a conversation_attachments record for user uploads. Absent for
  // generated images, whose bytes live on the message record itself.
  attachment_id: z.string().optional(),
  // The protected file's name on the message record (used to fetch the bytes).
  file_name: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type MessageAttachment = z.infer<typeof MessageAttachment>;

/**
 * MessageData is the decrypted data object of a message.
 *
 * As the message is encrypted and written in the backend, this
 * interface must be kept up to date with the MessageRecordData struct
 * in the backend.
 */
export const MessageData = z.object({
  version: MessageDataVersion.optional(),
  content: z.string().nullable(), // the message content
  // Provider-returned reasoning text for assistant messages, when the model
  // exposes it. Encrypted at rest alongside content; mirrors the backend's
  // MessageRecordData.Reasoning. Optional and absent for most messages.
  reasoning: z.string().optional(),
  conversation_id: z.string().optional(),
  parent_message_id: z.string().optional(),
  // RFC 3339 timestamp set by the backend inside the encrypted blob, so no
  // message-timing metadata is stored in a plaintext column. Optional because
  // messages created before this field existed won't carry it.
  created_at: z.string().optional(),
  persona_id: z.string().optional(), // the persona used when generating the message
  model_id: z.string().optional(), // the model used when generating the message
  owner_id: z.string().optional(), // the user who sent the message
  // Provider usage counts for the turn that produced this assistant message:
  // input_tokens is the real prompt size that was sent, output_tokens the reply
  // size. Used for accurate context planning (spec §10.1). Absent on user
  // messages and on messages created before this field existed.
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  // Encrypted attachments (e.g. generated images) referenced by this message.
  attachments: z.array(MessageAttachment).optional(),
  // Tombstone flag set when the message is soft-deleted. The content is cleared
  // but the role/parent/timestamp are preserved so the thread structure and the
  // LLM context marker stay correct.
  deleted: z.boolean().optional(),
});
export type MessageData = z.infer<typeof MessageData>;

/**
 * parseMessageData - takes a decrypted string
 * and returns a MessageData object.
 *
 * @param decryptedData (Uint8Array) decrypted bytes
 * @returns (MessageData) parsed message data
 */
export const parseMessageData = (decryptedData: Uint8Array): MessageData => {
  const dataString = new TextDecoder().decode(decryptedData);
  return MessageData.parse(JSON.parse(dataString));
};

export interface Message {
  // the record id of the message but may be undefined as messages encrypted
  //  in the backend don't currently send their IDs to the frontend
  record_id?: string;
  decryptedData: MessageData;
  createdAt: Date;
  expires?: Date;
  parentMessageId?: string;
  isStreaming?: boolean;
  // Client-only object URLs for decrypted attachments (e.g. generated images),
  // populated after the encrypted file is fetched and decrypted. Never persisted.
  imageUrls?: string[];
}

export const isMessageFromUser = (messageData: MessageData): boolean => {
  return messageData.owner_id !== undefined && messageData.owner_id.trim() !== '';
};
