/// <reference lib="webworker" />
import {
  MAX_IMPORT_CONVERSATIONS,
  MAX_IMPORT_MESSAGES,
  parseImportJson,
} from './import-parser';
import {
  ImportParseError,
  ImportPreview,
  ImportSource,
  emptyWarnings,
} from './import-types';
import { extractConversationJsonFiles } from './zip-archive';

interface ParseRequest {
  type: 'parse';
  requestId: string;
  source: ImportSource;
  buffer: ArrayBuffer;
}

type WorkerResponse =
  | { type: 'progress'; requestId: string; stage: 'validated' | 'parsed' }
  | { type: 'preview'; requestId: string; preview: ImportPreview }
  | { type: 'error'; requestId: string; reason: string };

addEventListener('message', ({ data }: MessageEvent<ParseRequest>) => {
  if (data.type !== 'parse') return;
  void parse(data);
});

async function parse(request: ParseRequest): Promise<void> {
  try {
    const bytes = new Uint8Array(request.buffer);
    const zip =
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04;
    const texts = zip
      ? await extractConversationJsonFiles(bytes)
      : [new TextDecoder('utf-8', { fatal: true }).decode(bytes)];
    send({ type: 'progress', requestId: request.requestId, stage: 'validated' });
    const previews = texts.map((text) => parseImportJson(request.source, text));
    const conversations = previews.flatMap((preview) => preview.conversations);
    const messageCount = conversations.reduce(
      (total, conversation) => total + conversation.messages.length,
      0,
    );
    if (
      conversations.length > MAX_IMPORT_CONVERSATIONS ||
      messageCount > MAX_IMPORT_MESSAGES
    ) {
      throw new ImportParseError('too_large');
    }
    const preview: ImportPreview = {
      source: request.source,
      conversations,
      totals: conversations.reduce(
        (totals, conversation) => ({
          messages: totals.messages + conversation.messages.length,
          attachments: totals.attachments + conversation.warnings.attachments,
          images: totals.images + conversation.warnings.images,
          tools: totals.tools + conversation.warnings.tools,
          unsupported: totals.unsupported + conversation.warnings.unsupported,
          ambiguousBranches:
            totals.ambiguousBranches + conversation.warnings.ambiguousBranches,
        }),
        { messages: 0, ...emptyWarnings() },
      ),
    };
    send({ type: 'progress', requestId: request.requestId, stage: 'parsed' });
    send({ type: 'preview', requestId: request.requestId, preview });
  } catch (error) {
    send({
      type: 'error',
      requestId: request.requestId,
      reason: error instanceof ImportParseError ? error.reason : 'unsupported_schema',
    });
  }
}

function send(response: WorkerResponse): void {
  postMessage(response);
}
