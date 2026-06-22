import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Conversation } from '@app/interfaces/conversation';

import { CognosApiService } from './cognos-api.service';
import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';
import { ExportService } from './export.service';

function encode(data: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(data));
}

describe('ExportService', () => {
  const listConversationMessages = vi.fn();
  const fetchAttachmentBytes = vi.fn();
  const openSealedBox = vi.fn();
  const openSecretBox = vi.fn();
  let service: ExportService;

  const conversation = {
    record: {
      id: 'conv-1',
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-02T00:00:00Z',
    },
    decryptedData: { title: 'Quarterly Review' },
    keyPair: {},
  } as unknown as Conversation;

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        ExportService,
        {
          provide: CognosApiService,
          useValue: { listConversationMessages, fetchAttachmentBytes },
        },
        {
          provide: ConversationService,
          useValue: { conversationList: () => [conversation] },
        },
        { provide: CryptoService, useValue: { openSealedBox, openSecretBox } },
      ],
    });
    service = TestBed.inject(ExportService);

    // API returns newest-first: the assistant reply, then the user prompt.
    listConversationMessages.mockReturnValue(
      of({
        page: 1,
        perPage: 100,
        totalItems: 2,
        totalPages: 1,
        items: [
          { id: 'm2', data: 'AQ==' },
          { id: 'm1', data: 'AQ==' },
        ],
      }),
    );
    openSealedBox
      .mockReturnValueOnce(
        encode({
          content: 'The numbers look good.',
          parent_message_id: 'm1',
          created_at: '2026-01-01T00:00:02Z',
          model_id: 'eu-model',
          persona_id: 'cognos:simple-assistant',
        }),
      )
      .mockReturnValueOnce(
        encode({
          content: 'Summarise Q1.',
          owner_id: 'user-1',
          created_at: '2026-01-01T00:00:01Z',
        }),
      );
  });

  it('exports a single conversation oldest-first with parent links preserved', async () => {
    const payload = await service.buildConversationExport(
      conversation,
      new Date('2026-06-21T00:00:00Z'),
    );

    expect(payload.conversation_count).toBe(1);
    const messages = payload.conversations[0].messages;

    // Oldest-first: the user prompt, then the assistant reply that points back.
    expect(messages[0]).toMatchObject({
      record_id: 'm1',
      role: 'user',
      content: 'Summarise Q1.',
    });
    expect(messages[1]).toMatchObject({
      record_id: 'm2',
      role: 'assistant',
      content: 'The numbers look good.',
      parent_message_id: 'm1',
    });
  });

  it('includes parent_message_id in the full data export too', async () => {
    const payload = await service.buildExport(new Date('2026-06-21T00:00:00Z'));

    expect(payload.conversation_count).toBe(1);
    expect(payload.conversations[0].messages[1].parent_message_id).toBe('m1');
  });

  it('references decrypted image attachments by archive path', async () => {
    // One assistant image message: data decrypts to an attachment, then the
    // attachment file is fetched and decrypted to bytes.
    listConversationMessages.mockReturnValue(
      of({
        page: 1,
        perPage: 100,
        totalItems: 1,
        totalPages: 1,
        items: [{ id: 'img1', data: 'AQ==' }],
      }),
    );
    openSealedBox.mockReset();
    openSealedBox
      // First call: decrypt the message data (carrying the attachment metadata).
      .mockReturnValueOnce(
        encode({
          content: '',
          created_at: '2026-01-01T00:00:03Z',
          model_id: 'gemini-2-5-flash-image',
          attachments: [
            { kind: 'generated_image', mime_type: 'image/png', sealed_key: 'c2s=' },
          ],
        }),
      )
      // Second call: unseal the per-attachment symmetric key.
      .mockReturnValueOnce(new Uint8Array(32));
    fetchAttachmentBytes.mockReturnValue(of(new Uint8Array([1, 2, 3])));
    openSecretBox.mockReturnValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    const payload = await service.buildConversationExport(
      conversation,
      new Date('2026-06-21T00:00:00Z'),
    );

    const message = payload.conversations[0].messages[0];
    expect(message.attachments).toEqual([
      {
        kind: 'generated_image',
        mime_type: 'image/png',
        file: 'images/img1-0.png',
        width: undefined,
        height: undefined,
      },
    ]);
    // The attachment was fetched via the conversation-scoped route and decrypted.
    expect(fetchAttachmentBytes).toHaveBeenCalledWith('conv-1', 'img1');
    expect(openSecretBox).toHaveBeenCalledTimes(1);
  });
});
