import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';

import { TranslocoService } from '@jsverse/transloco';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Conversation } from '@app/interfaces/conversation';
import { Message } from '@app/interfaces/message';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ConversationService } from '@app/services/conversation.service';
import { CryptoService } from '@app/services/crypto.service';
import { RedactionService } from '@app/services/redaction.service';

import { CogDocBlock } from './cog-doc/cog-doc.types';
import {
  DOCUMENT_SAVE_BLOB,
  DOCUMENT_WORKER_CLIENT,
  DocumentExportService,
} from './document-export.service';
import { DocumentWorkerClient } from './document-worker.client';
import { DocumentRenderError } from './document.types';

function buildMessage(
  content: string | null,
  overrides: Partial<Message> = {},
): Message {
  return {
    record_id: 'msg-1',
    createdAt: new Date('2026-07-04T00:00:00Z'),
    decryptedData: { content },
    ...overrides,
  } as Message;
}

const conversation: Conversation = {
  record: { id: 'conv-1', project: 'proj-1' },
  decryptedData: { title: 'Quarterly Review' },
  keyPair: {},
} as unknown as Conversation;

describe('DocumentExportService', () => {
  const hydrate = vi.fn((_id: unknown, content: string) => content);
  const fetchAttachmentBytes = vi.fn();
  const openSealedBox = vi.fn();
  const openSecretBox = vi.fn();
  const render = vi.fn();
  const saveBlob = vi.fn();

  let currentConversation: Conversation | undefined = conversation;
  let service: DocumentExportService;
  let translate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    hydrate.mockImplementation((_id: unknown, content: string) => content);
    currentConversation = conversation;

    TestBed.configureTestingModule({
      providers: [
        DocumentExportService,
        { provide: RedactionService, useValue: { hydrate } },
        {
          provide: ConversationService,
          useValue: { conversation: () => currentConversation },
        },
        { provide: CognosApiService, useValue: { fetchAttachmentBytes } },
        { provide: CryptoService, useValue: { openSealedBox, openSecretBox } },
        {
          provide: DOCUMENT_WORKER_CLIENT,
          useValue: { render } as unknown as DocumentWorkerClient,
        },
        { provide: DOCUMENT_SAVE_BLOB, useValue: saveBlob },
      ],
    });
    // TranslocoService is provided globally (test-providers.ts) with the real
    // en catalogue wired to an APP_INITIALIZER — replacing the whole service
    // breaks that initializer, so this spies on the real instance instead.
    translate = vi
      .spyOn(TestBed.inject(TranslocoService), 'translate')
      .mockReturnValue('Untitled document');
    service = TestBed.inject(DocumentExportService);
  });

  it('throws empty_document when the message has no content', async () => {
    await expect(
      service.downloadMessageAs(buildMessage(null), 'markdown'),
    ).rejects.toMatchObject({ code: 'empty_document' });
    await expect(
      service.downloadMessageAs(buildMessage(''), 'markdown'),
    ).rejects.toMatchObject({ code: 'empty_document' });
  });

  it('hydrates content against the conversation and project scope', async () => {
    await service.downloadMessageAs(buildMessage('# Title\n\nBody'), 'markdown');

    expect(hydrate).toHaveBeenCalledWith('conv-1', '# Title\n\nBody', 'proj-1');
  });

  it('hydrates with undefined conversation/project when there is no active conversation', async () => {
    currentConversation = undefined;
    await service.downloadMessageAs(buildMessage('# Title\n\nBody'), 'markdown');

    expect(hydrate).toHaveBeenCalledWith(undefined, '# Title\n\nBody', undefined);
  });

  it('bypasses the render worker entirely for markdown', async () => {
    await service.downloadMessageAs(buildMessage('# Title\n\nBody'), 'markdown');

    expect(render).not.toHaveBeenCalled();
    expect(saveBlob).toHaveBeenCalledTimes(1);
    const [bytes, filename, mime] = saveBlob.mock.calls[0];
    expect(new TextDecoder().decode(bytes)).toBe('# Title\n\nBody');
    expect(filename).toBe('Quarterly Review.md');
    expect(mime).toBe('text/markdown');
  });

  it('derives the filename/title from the conversation title first', async () => {
    render.mockResolvedValue(new Uint8Array([1]));
    await service.downloadMessageAs(buildMessage('# Ignored Heading\n\nBody'), 'docx');

    expect(saveBlob.mock.calls[0][1]).toBe('Quarterly Review.docx');
    expect(render).toHaveBeenCalledWith('docx', '# Ignored Heading\n\nBody', [], {
      title: 'Quarterly Review',
    });
  });

  it('falls back to the first H1 when the conversation has no title', async () => {
    currentConversation = {
      ...conversation,
      decryptedData: { title: '' },
    } as Conversation;
    render.mockResolvedValue(new Uint8Array([1]));

    await service.downloadMessageAs(
      buildMessage('Intro\n\n# My Heading\n\nBody'),
      'pdf',
    );

    expect(saveBlob.mock.calls[0][1]).toBe('My Heading.pdf');
    expect(render).toHaveBeenCalledWith('pdf', 'Intro\n\n# My Heading\n\nBody', [], {
      title: 'My Heading',
    });
  });

  it('falls back to the translated default name when there is no title or heading', async () => {
    currentConversation = {
      ...conversation,
      decryptedData: { title: '' },
    } as Conversation;
    render.mockResolvedValue(new Uint8Array([1]));

    await service.downloadMessageAs(
      buildMessage('Just a paragraph, no heading.'),
      'pdf',
    );

    expect(translate).toHaveBeenCalledWith('chat.message.documentDefaultName');
    expect(saveBlob.mock.calls[0][1]).toBe('Untitled document.pdf');
    expect(render).toHaveBeenCalledWith('pdf', 'Just a paragraph, no heading.', [], {
      title: undefined,
    });
  });

  it('decrypts generated-image attachments and passes them to the renderer', async () => {
    render.mockResolvedValue(new Uint8Array([1]));
    fetchAttachmentBytes.mockReturnValue(of(new Uint8Array([9, 9, 9])));
    openSealedBox.mockReturnValue(new Uint8Array([1, 2, 3]));
    openSecretBox.mockReturnValue(new Uint8Array([4, 5, 6]));

    const message = buildMessage('Here is your image.', {
      decryptedData: {
        content: 'Here is your image.',
        attachments: [
          {
            kind: 'generated_image',
            mime_type: 'image/png',
            sealed_key: 'c2VhbGVk',
            width: 512,
            height: 256,
          },
        ],
      },
    });

    await service.downloadMessageAs(message, 'docx');

    expect(fetchAttachmentBytes).toHaveBeenCalledWith('conv-1', 'msg-1');
    expect(render).toHaveBeenCalledWith(
      'docx',
      'Here is your image.',
      [
        {
          bytes: new Uint8Array([4, 5, 6]),
          mime: 'image/png',
          width: 512,
          height: 256,
        },
      ],
      { title: 'Quarterly Review' },
    );
  });

  it('skips user-upload attachments and undecryptable images (fail open)', async () => {
    render.mockResolvedValue(new Uint8Array([1]));
    fetchAttachmentBytes.mockReturnValue(of(new Uint8Array([9])));
    openSealedBox.mockImplementation(() => {
      throw new Error('cannot open');
    });

    const message = buildMessage('Body', {
      decryptedData: {
        content: 'Body',
        attachments: [
          { kind: 'user_upload', mime_type: 'text/plain', attachment_id: 'lib-1' },
          { kind: 'generated_image', mime_type: 'image/png', sealed_key: 'c2VhbGVk' },
        ],
      },
    });

    await service.downloadMessageAs(message, 'docx');

    expect(render).toHaveBeenCalledWith('docx', 'Body', [], {
      title: 'Quarterly Review',
    });
  });

  it('propagates a render worker failure as a DocumentRenderError', async () => {
    render.mockRejectedValue(new DocumentRenderError('render_failed', 'boom'));

    await expect(
      service.downloadMessageAs(buildMessage('# Title\n\nBody'), 'docx'),
    ).rejects.toMatchObject({ name: 'DocumentRenderError', code: 'render_failed' });
    expect(saveBlob).not.toHaveBeenCalled();
  });

  describe('downloadCogDoc', () => {
    function buildBlock(overrides: Partial<CogDocBlock> = {}): CogDocBlock {
      return {
        state: 'ready',
        spec: { format: 'docx' },
        body: '# Report\n\nBody',
        raw: "<cog-doc spec='{}'>\n# Report\n\nBody\n</cog-doc>",
        ...overrides,
      };
    }

    it('rejects a block that is not ready', async () => {
      await expect(
        service.downloadCogDoc(buildBlock({ state: 'streaming' }), buildMessage('x')),
      ).rejects.toMatchObject({ code: 'empty_document' });
      await expect(
        service.downloadCogDoc(buildBlock({ state: 'invalid' }), buildMessage('x')),
      ).rejects.toMatchObject({ code: 'empty_document' });
      expect(render).not.toHaveBeenCalled();
    });

    it('rejects a ready block with no spec', async () => {
      await expect(
        service.downloadCogDoc(buildBlock({ spec: null }), buildMessage('x')),
      ).rejects.toMatchObject({ code: 'empty_document' });
    });

    it('routes the render format from the spec, not a fixed default', async () => {
      render.mockResolvedValue(new Uint8Array([1]));

      await service.downloadCogDoc(
        buildBlock({ spec: { format: 'pdf' } }),
        buildMessage('x'),
      );

      expect(render).toHaveBeenCalledWith(
        'pdf',
        '# Report\n\nBody',
        [],
        expect.any(Object),
      );
    });

    it('hydrates the block body against the conversation/project scope', async () => {
      render.mockResolvedValue(new Uint8Array([1]));

      await service.downloadCogDoc(buildBlock(), buildMessage('x'));

      expect(hydrate).toHaveBeenCalledWith('conv-1', '# Report\n\nBody', 'proj-1');
    });

    it('derives the filename from spec.filename first', async () => {
      render.mockResolvedValue(new Uint8Array([1]));

      await service.downloadCogDoc(
        buildBlock({
          spec: { format: 'docx', filename: 'my-file', title: 'My Title' },
          body: '# My Heading\n\nBody',
        }),
        buildMessage('x'),
      );

      expect(saveBlob.mock.calls[0][1]).toBe('my-file.docx');
    });

    it('falls back to spec.title when filename is absent', async () => {
      render.mockResolvedValue(new Uint8Array([1]));

      await service.downloadCogDoc(
        buildBlock({
          spec: { format: 'docx', title: 'My Title' },
          body: '# My Heading\n\nBody',
        }),
        buildMessage('x'),
      );

      expect(saveBlob.mock.calls[0][1]).toBe('My Title.docx');
    });

    it('falls back to the first H1 in the body when spec has neither', async () => {
      render.mockResolvedValue(new Uint8Array([1]));

      await service.downloadCogDoc(
        buildBlock({ spec: { format: 'docx' }, body: '# My Heading\n\nBody' }),
        buildMessage('x'),
      );

      expect(saveBlob.mock.calls[0][1]).toBe('My Heading.docx');
    });

    it('falls back to the translated default name when spec and body give nothing', async () => {
      render.mockResolvedValue(new Uint8Array([1]));

      await service.downloadCogDoc(
        buildBlock({ spec: { format: 'docx' }, body: 'Just a paragraph.' }),
        buildMessage('x'),
      );

      expect(translate).toHaveBeenCalledWith('chat.message.documentDefaultName');
      expect(saveBlob.mock.calls[0][1]).toBe('Untitled document.docx');
    });

    it('maps spec render options (page/header/footer) onto the worker call', async () => {
      render.mockResolvedValue(new Uint8Array([1]));

      await service.downloadCogDoc(
        buildBlock({
          spec: {
            format: 'pdf',
            title: 'Report',
            page: { orientation: 'landscape' },
            footer: { pageNumbers: true },
          },
        }),
        buildMessage('x'),
      );

      expect(render).toHaveBeenCalledWith('pdf', '# Report\n\nBody', [], {
        title: 'Report',
        page: { size: 'A4', orientation: 'landscape' },
        footer: { pageNumbers: true },
      });
    });

    it('decrypts the message generated images exactly as downloadMessageAs does', async () => {
      render.mockResolvedValue(new Uint8Array([1]));
      fetchAttachmentBytes.mockReturnValue(of(new Uint8Array([9, 9, 9])));
      openSealedBox.mockReturnValue(new Uint8Array([1, 2, 3]));
      openSecretBox.mockReturnValue(new Uint8Array([4, 5, 6]));

      const message = buildMessage('carrier message', {
        decryptedData: {
          content: 'carrier message',
          attachments: [
            {
              kind: 'generated_image',
              mime_type: 'image/png',
              sealed_key: 'c2VhbGVk',
              width: 10,
              height: 20,
            },
          ],
        },
      });

      await service.downloadCogDoc(buildBlock(), message);

      expect(fetchAttachmentBytes).toHaveBeenCalledWith('conv-1', 'msg-1');
      expect(render).toHaveBeenCalledWith(
        'docx',
        '# Report\n\nBody',
        [
          {
            bytes: new Uint8Array([4, 5, 6]),
            mime: 'image/png',
            width: 10,
            height: 20,
          },
        ],
        expect.any(Object),
      );
    });

    it('propagates a render worker failure as a DocumentRenderError', async () => {
      render.mockRejectedValue(new DocumentRenderError('render_failed', 'boom'));

      await expect(
        service.downloadCogDoc(buildBlock(), buildMessage('x')),
      ).rejects.toMatchObject({ name: 'DocumentRenderError', code: 'render_failed' });
      expect(saveBlob).not.toHaveBeenCalled();
    });
  });
});
