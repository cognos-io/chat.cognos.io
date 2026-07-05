import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';

import { TranslocoService } from '@jsverse/transloco';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AttachmentProcessingService } from '@app/attachments/attachment-processing.service';
import { Conversation } from '@app/interfaces/conversation';
import { Message } from '@app/interfaces/message';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ConversationService } from '@app/services/conversation.service';
import { CryptoService } from '@app/services/crypto.service';
import { RedactionService } from '@app/services/redaction.service';
import { VaultService } from '@app/services/vault.service';

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
  const renderSheet = vi.fn();
  const saveBlob = vi.fn();
  const redactionEnabled = vi.fn(() => false);
  const keyPair = vi.fn((): { publicKey: Uint8Array } | undefined => ({
    publicKey: new Uint8Array([7, 7, 7]),
  }));
  const saveToLibrary = vi.fn();

  let currentConversation: Conversation | undefined = conversation;
  let service: DocumentExportService;
  let translate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    hydrate.mockImplementation((_id: unknown, content: string) => content);
    redactionEnabled.mockReturnValue(false);
    keyPair.mockReturnValue({ publicKey: new Uint8Array([7, 7, 7]) });
    saveToLibrary.mockResolvedValue(undefined);
    currentConversation = conversation;

    TestBed.configureTestingModule({
      providers: [
        DocumentExportService,
        { provide: RedactionService, useValue: { hydrate, enabled: redactionEnabled } },
        {
          provide: ConversationService,
          useValue: { conversation: () => currentConversation },
        },
        { provide: CognosApiService, useValue: { fetchAttachmentBytes } },
        { provide: CryptoService, useValue: { openSealedBox, openSecretBox } },
        {
          provide: DOCUMENT_WORKER_CLIENT,
          useValue: { render, renderSheet } as unknown as DocumentWorkerClient,
        },
        { provide: DOCUMENT_SAVE_BLOB, useValue: saveBlob },
        { provide: VaultService, useValue: { keyPair } },
        { provide: AttachmentProcessingService, useValue: { saveToLibrary } },
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

    describe('xlsx routing (spec §5.3)', () => {
      function buildSheetBlock(overrides: Partial<CogDocBlock> = {}): CogDocBlock {
        return buildBlock({
          spec: { format: 'xlsx', title: 'Revenue' },
          body: '{"sheets":[{"name":"Sheet1","rows":[["A"]]}]}',
          raw: "<cog-doc spec='{}'>\n{}\n</cog-doc>",
          ...overrides,
        });
      }

      it('routes xlsx through renderSheet instead of render', async () => {
        renderSheet.mockResolvedValue({ bytes: new Uint8Array([1]), warnings: [] });

        await service.downloadCogDoc(buildSheetBlock(), buildMessage('x'));

        expect(render).not.toHaveBeenCalled();
        expect(renderSheet).toHaveBeenCalledWith(
          '{"sheets":[{"name":"Sheet1","rows":[["A"]]}]}',
          { title: 'Revenue' },
        );
        expect(saveBlob).toHaveBeenCalledWith(
          new Uint8Array([1]),
          'Revenue.xlsx',
          expect.stringContaining('spreadsheetml'),
        );
      });

      it('hydrates the sheet body (cell strings can carry redaction tokens)', async () => {
        renderSheet.mockResolvedValue({ bytes: new Uint8Array([1]), warnings: [] });
        hydrate.mockReturnValue('{"sheets":[{"name":"Sheet1","rows":[["hydrated"]]}]}');

        await service.downloadCogDoc(buildSheetBlock(), buildMessage('x'));

        expect(hydrate).toHaveBeenCalledWith(
          'conv-1',
          '{"sheets":[{"name":"Sheet1","rows":[["A"]]}]}',
          'proj-1',
        );
        expect(renderSheet).toHaveBeenCalledWith(
          '{"sheets":[{"name":"Sheet1","rows":[["hydrated"]]}]}',
          expect.any(Object),
        );
      });

      it('resolves with undefined when the formula validator raises no warnings', async () => {
        renderSheet.mockResolvedValue({ bytes: new Uint8Array([1]), warnings: [] });

        await expect(
          service.downloadCogDoc(buildSheetBlock(), buildMessage('x')),
        ).resolves.toBeUndefined();
      });

      it('resolves with the formula validator warnings when present', async () => {
        const warnings = [
          { kind: 'ref_out_of_range', sheet: 'Sheet1', cell: 'B2', detail: 'B2' },
        ];
        renderSheet.mockResolvedValue({ bytes: new Uint8Array([1]), warnings });

        await expect(
          service.downloadCogDoc(buildSheetBlock(), buildMessage('x')),
        ).resolves.toEqual(warnings);
      });

      it('never decrypts generated images for xlsx (no image support, spec §5.3)', async () => {
        renderSheet.mockResolvedValue({ bytes: new Uint8Array([1]), warnings: [] });

        const message = buildMessage('carrier', {
          decryptedData: {
            content: 'carrier',
            attachments: [
              {
                kind: 'generated_image',
                mime_type: 'image/png',
                sealed_key: 'c2VhbGVk',
              },
            ],
          },
        });

        await service.downloadCogDoc(buildSheetBlock(), message);

        expect(fetchAttachmentBytes).not.toHaveBeenCalled();
      });

      it('propagates a renderSheet failure as a DocumentRenderError', async () => {
        renderSheet.mockRejectedValue(new DocumentRenderError('render_failed', 'boom'));

        await expect(
          service.downloadCogDoc(buildSheetBlock(), buildMessage('x')),
        ).rejects.toMatchObject({ name: 'DocumentRenderError', code: 'render_failed' });
        expect(saveBlob).not.toHaveBeenCalled();
      });
    });
  });

  describe('saveCogDocToLibrary', () => {
    function buildBlock(overrides: Partial<CogDocBlock> = {}): CogDocBlock {
      return {
        state: 'ready',
        spec: { format: 'docx', filename: 'my-file' },
        body: '# Report\n\nBody',
        raw: "<cog-doc spec='{}'>\n# Report\n\nBody\n</cog-doc>",
        ...overrides,
      };
    }

    it('never triggers a download (no saveBlob call)', async () => {
      render.mockResolvedValue(new Uint8Array([1, 2, 3]));

      await service.saveCogDocToLibrary(buildBlock(), buildMessage('x'));

      expect(saveBlob).not.toHaveBeenCalled();
    });

    it('builds a File with the rendered bytes, filename and mime, and hands it to the processing service', async () => {
      render.mockResolvedValue(new Uint8Array([1, 2, 3]));

      await service.saveCogDocToLibrary(buildBlock(), buildMessage('x'));

      expect(saveToLibrary).toHaveBeenCalledTimes(1);
      const [file, ownerPublicKey, redact] = saveToLibrary.mock.calls[0];
      expect(file).toBeInstanceOf(File);
      expect(file.name).toBe('my-file.docx');
      expect(file.type).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(
        new Uint8Array([1, 2, 3]),
      );
      expect(ownerPublicKey).toEqual(new Uint8Array([7, 7, 7]));
      expect(redact).toBe(false);
    });

    it('passes the current redaction toggle value through to the processing service', async () => {
      render.mockResolvedValue(new Uint8Array([1]));
      redactionEnabled.mockReturnValue(true);

      await service.saveCogDocToLibrary(buildBlock(), buildMessage('x'));

      expect(saveToLibrary.mock.calls[0][2]).toBe(true);
    });

    it('routes xlsx through renderSheet, same as downloadCogDoc', async () => {
      renderSheet.mockResolvedValue({ bytes: new Uint8Array([9]), warnings: [] });

      await service.saveCogDocToLibrary(
        buildBlock({
          spec: { format: 'xlsx', title: 'Revenue' },
          body: '{"sheets":[]}',
        }),
        buildMessage('x'),
      );

      expect(render).not.toHaveBeenCalled();
      const [file] = saveToLibrary.mock.calls[0];
      expect(file.name).toBe('Revenue.xlsx');
      expect(file.type).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    });

    it('rejects a block that is not ready without calling the processing service', async () => {
      await expect(
        service.saveCogDocToLibrary(
          buildBlock({ state: 'streaming' }),
          buildMessage('x'),
        ),
      ).rejects.toMatchObject({ code: 'empty_document' });
      expect(saveToLibrary).not.toHaveBeenCalled();
    });

    it('rejects with a DocumentRenderError when the vault is locked, without rendering the failure as a download', async () => {
      render.mockResolvedValue(new Uint8Array([1]));
      keyPair.mockReturnValue(undefined);

      await expect(
        service.saveCogDocToLibrary(buildBlock(), buildMessage('x')),
      ).rejects.toMatchObject({ name: 'DocumentRenderError', code: 'render_failed' });
      expect(saveToLibrary).not.toHaveBeenCalled();
    });

    it('propagates a processing service failure', async () => {
      render.mockResolvedValue(new Uint8Array([1]));
      saveToLibrary.mockRejectedValue(new Error('upload failed'));

      await expect(
        service.saveCogDocToLibrary(buildBlock(), buildMessage('x')),
      ).rejects.toThrow('upload failed');
    });
  });
});
