import { TestBed } from '@angular/core/testing';

import { Observable, of } from 'rxjs';

import { unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AttachmentLibraryService } from '@app/attachments/attachment-library.service';
import { Conversation } from '@app/interfaces/conversation';

import { CognosApiService } from './cognos-api.service';
import { CompactionService } from './compaction.service';
import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';
import { ExportService } from './export.service';
import { PersonaService } from './persona.service';
import { ProjectService } from './project.service';
import { ScopedMemoryService } from './scoped-memory.service';

function encode(data: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(data));
}

describe('ExportService', () => {
  const listConversationMessages = vi.fn();
  const fetchAttachmentBytes = vi.fn();
  const openSealedBox = vi.fn();
  const openSecretBox = vi.fn();

  // Account-wide sources for the full export. Typed broadly so mockReturnValue
  // accepts the richer shapes individual tests supply.
  const customPersonas = vi.fn((): unknown[] => []);
  const projects = vi.fn((): unknown[] => []);
  const loadUserMemory = vi.fn((): Observable<unknown> => of(null));
  const loadProjectMemory = vi.fn((): Observable<unknown> => of(null));
  const compactionLoad = vi.fn((): Observable<unknown> => of([]));
  const libraryRefresh = vi.fn((): Observable<unknown> => of([]));
  const decryptOriginal = vi.fn();

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
    // Reset defaults (individual tests override as needed).
    customPersonas.mockReturnValue([]);
    projects.mockReturnValue([]);
    loadUserMemory.mockReturnValue(of(null));
    loadProjectMemory.mockReturnValue(of(null));
    compactionLoad.mockReturnValue(of([]));
    libraryRefresh.mockReturnValue(of([]));

    TestBed.configureTestingModule({
      providers: [
        ExportService,
        {
          provide: CognosApiService,
          useValue: { listConversationMessages, fetchAttachmentBytes },
        },
        {
          provide: ConversationService,
          useValue: {
            conversationList: () => [conversation],
            allConversations: () => [conversation],
          },
        },
        { provide: CryptoService, useValue: { openSealedBox, openSecretBox } },
        { provide: PersonaService, useValue: { customPersonas } },
        { provide: ProjectService, useValue: { projects } },
        {
          provide: ScopedMemoryService,
          useValue: { loadUserMemory, loadProjectMemory },
        },
        { provide: CompactionService, useValue: { load: compactionLoad } },
        {
          provide: AttachmentLibraryService,
          useValue: { refresh: libraryRefresh, decryptOriginal },
        },
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

    expect(payload.version).toBe('2');
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

  it('includes custom personas in the full export', async () => {
    customPersonas.mockReturnValue([
      {
        id: 'p1',
        recordId: 'rec-p1',
        name: 'Legal Reviewer',
        description: 'Reviews contracts',
        systemPrompt: 'You are a meticulous legal reviewer.',
        icon: 'scale',
        color: 'indigo',
        authorId: 'user-1',
        source: 'user',
      },
    ]);

    const payload = await service.buildExport(new Date('2026-06-21T00:00:00Z'));

    expect(payload.personas).toEqual([
      {
        id: 'p1',
        record_id: 'rec-p1',
        name: 'Legal Reviewer',
        description: 'Reviews contracts',
        system_prompt: 'You are a meticulous legal reviewer.',
        icon: 'scale',
        color: 'indigo',
      },
    ]);
  });

  it('includes user + project memory and compactions', async () => {
    projects.mockReturnValue([
      {
        record: {
          id: 'proj-1',
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-05T00:00:00Z',
        },
        decryptedData: {
          name: 'Acme',
          description: 'Client work',
          instructions: 'Be concise',
          icon: 'folder',
          color: 'blue',
        },
        contentKey: new Uint8Array(32),
      },
    ]);
    loadUserMemory.mockReturnValue(
      of({
        recordId: 'um1',
        payload: { durable_memory: { items: ['Prefers metric units'] } },
      }),
    );
    loadProjectMemory.mockReturnValue(
      of({
        recordId: 'pm1',
        payload: { durable_memory: { items: ['Deadline is Q3'] } },
      }),
    );
    compactionLoad.mockReturnValue(
      of([
        {
          recordId: 'cmp1',
          conversationId: 'conv-1',
          createdAt: new Date('2026-01-02T00:00:00Z'),
          payload: {
            created_at: '2026-01-02T00:00:00Z',
            output_mode: 'auto',
            durable_memory: { items: ['User is reviewing Q1 numbers'] },
            rolling_narrative: 'Discussed quarterly results.',
          },
        },
      ]),
    );

    const payload = await service.buildExport(new Date('2026-06-21T00:00:00Z'));

    expect(payload.memory.user).toEqual({ items: ['Prefers metric units'] });
    expect(payload.memory.projects).toEqual([
      { project_id: 'proj-1', items: ['Deadline is Q3'] },
    ]);
    expect(payload.memory.compactions).toEqual([
      {
        conversation_id: 'conv-1',
        record_id: 'cmp1',
        created_at: '2026-01-02T00:00:00Z',
        output_mode: 'auto',
        durable_memory: ['User is reviewing Q1 numbers'],
        rolling_narrative: 'Discussed quarterly results.',
      },
    ]);
  });

  it('includes projects and the conversation→project mapping', async () => {
    const projectConversation = {
      record: {
        id: 'conv-proj',
        created: '2026-01-01T00:00:00Z',
        updated: '2026-01-02T00:00:00Z',
        project: 'proj-1',
      },
      decryptedData: { title: 'Kickoff' },
      keyPair: {},
    } as unknown as Conversation;

    TestBed.resetTestingModule();
    projects.mockReturnValue([
      {
        record: {
          id: 'proj-1',
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-05T00:00:00Z',
        },
        decryptedData: {
          name: 'Acme',
          description: 'Client work',
          instructions: 'Be concise',
          icon: 'folder',
          color: 'blue',
        },
        contentKey: new Uint8Array(32),
      },
    ]);
    TestBed.configureTestingModule({
      providers: [
        ExportService,
        {
          provide: CognosApiService,
          useValue: { listConversationMessages, fetchAttachmentBytes },
        },
        {
          provide: ConversationService,
          useValue: {
            conversationList: () => [projectConversation],
            allConversations: () => [projectConversation],
          },
        },
        { provide: CryptoService, useValue: { openSealedBox, openSecretBox } },
        { provide: PersonaService, useValue: { customPersonas } },
        { provide: ProjectService, useValue: { projects } },
        {
          provide: ScopedMemoryService,
          useValue: { loadUserMemory, loadProjectMemory },
        },
        { provide: CompactionService, useValue: { load: compactionLoad } },
        {
          provide: AttachmentLibraryService,
          useValue: { refresh: libraryRefresh, decryptOriginal },
        },
      ],
    });
    service = TestBed.inject(ExportService);

    const payload = await service.buildExport(new Date('2026-06-21T00:00:00Z'));

    expect(payload.projects).toEqual([
      {
        id: 'proj-1',
        name: 'Acme',
        description: 'Client work',
        instructions: 'Be concise',
        icon: 'folder',
        color: 'blue',
        created: '2026-01-01T00:00:00Z',
        updated: '2026-01-05T00:00:00Z',
      },
    ]);
    expect(payload.conversations[0].project_id).toBe('proj-1');
  });

  it('bundles a library file into the zip and records a skipped one', async () => {
    const smallFile = {
      id: 'file-ok',
      displayName: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 12,
      createdAt: '2026-01-01T00:00:00Z',
    };
    const hugeFile = {
      id: 'file-big',
      displayName: 'video.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 30 * 1024 * 1024,
      createdAt: '2026-01-01T00:00:00Z',
    };
    libraryRefresh.mockReturnValue(of([smallFile, hugeFile]));
    decryptOriginal.mockResolvedValue(new Uint8Array([104, 101, 108, 108, 111]));

    const payload = await service.buildExport(new Date('2026-06-21T00:00:00Z'));

    expect(payload.attachments).toEqual([
      {
        id: 'file-ok',
        name: 'notes.txt',
        mime_type: 'text/plain',
        size_bytes: 12,
        created_at: '2026-01-01T00:00:00Z',
        file: 'files/file-ok-notes.txt',
      },
      {
        id: 'file-big',
        name: 'video.mp4',
        mime_type: 'video/mp4',
        size_bytes: 30 * 1024 * 1024,
        created_at: '2026-01-01T00:00:00Z',
        skipped: 'file_too_large',
      },
    ]);
    // Only the small file's bytes were decrypted for bundling.
    expect(decryptOriginal).toHaveBeenCalledTimes(1);
    expect(decryptOriginal).toHaveBeenCalledWith(smallFile);
  });

  it('records a decrypt failure as skipped rather than failing the export', async () => {
    const file = {
      id: 'file-bad',
      displayName: 'secret.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: 8,
      createdAt: '2026-01-01T00:00:00Z',
    };
    libraryRefresh.mockReturnValue(of([file]));
    decryptOriginal.mockRejectedValue(new Error('bad key'));

    const payload = await service.buildExport(new Date('2026-06-21T00:00:00Z'));

    expect(payload.attachments).toEqual([
      {
        id: 'file-bad',
        name: 'secret.bin',
        mime_type: 'application/octet-stream',
        size_bytes: 8,
        created_at: '2026-01-01T00:00:00Z',
        skipped: 'decrypt_failed',
      },
    ]);
  });

  it('delivers a zip containing the bundled library file bytes', async () => {
    const file = {
      id: 'file-ok',
      displayName: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      createdAt: '2026-01-01T00:00:00Z',
    };
    libraryRefresh.mockReturnValue(of([file]));
    decryptOriginal.mockResolvedValue(new Uint8Array([104, 101, 108, 108, 111]));

    // saveBlob is a module-level util; intercept the anchor download path by
    // capturing the delivered blob via URL.createObjectURL.
    const created: Blob[] = [];
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return 'blob:mock';
    }) as typeof URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    await service.downloadExport(new Date('2026-06-21T00:00:00Z'));

    const savedBlob = created[0];
    const savedName = clickSpy.mock.instances[0]
      ? (clickSpy.mock.instances[0] as HTMLAnchorElement).download
      : undefined;
    expect(savedName?.endsWith('.zip')).toBe(true);
    const bytes = new Uint8Array(await savedBlob.arrayBuffer());
    const unzipped = unzipSync(bytes);
    expect(Object.keys(unzipped)).toContain('files/file-ok-notes.txt');
    expect(unzipped['files/file-ok-notes.txt']).toEqual(
      new Uint8Array([104, 101, 108, 108, 111]),
    );
    expect(Object.keys(unzipped)).toContain('export.json');

    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    clickSpy.mockRestore();
  });
});
