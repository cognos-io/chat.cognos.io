import { z } from 'zod';

export const MessageDataVersion = z.enum(['1']);
export type MessageDataVersion = z.infer<typeof MessageDataVersion>;

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
  agent_id: z.string().optional(), // the agent used when generating the message
  model_id: z.string().optional(), // the model used when generating the message
  owner_id: z.string().optional(), // the user who sent the message
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
  parentMessageId?: string;
}

export const isMessageFromUser = (messageData: MessageData): boolean => {
  return messageData.owner_id !== undefined && messageData.owner_id.trim() !== '';
};
