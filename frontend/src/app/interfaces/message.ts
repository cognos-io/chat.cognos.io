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
  content: z.string(), // the message content
});
export type MessageData = z.infer<typeof MessageData>;
