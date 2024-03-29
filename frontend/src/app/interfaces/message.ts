import { z } from 'zod';

import { MessagesResponse } from '@app/types/pocketbase-types';

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
  content: z.string(), // the message content
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
  record: MessagesResponse;
  decryptedData: MessageData;
}
