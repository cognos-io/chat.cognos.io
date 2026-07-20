import { TestBed } from '@angular/core/testing';

import { firstValueFrom, lastValueFrom, of, throwError, toArray } from 'rxjs';

import { Base64 } from 'js-base64';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Project, ProjectData } from '@app/interfaces/project';

import { CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { ProjectRotationError, ProjectSharingService } from './project-sharing.service';
import { ProjectService } from './project.service';

// --- Deterministic crypto fakes ---------------------------------------------
// Real crypto is exercised elsewhere; here we only need to see WHAT was
// wrapped with WHICH key, so every fake returns a readable byte string.

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (data: Uint8Array): string => new TextDecoder().decode(data);

const NEW_KEY = bytes('new-content-key');
const OLD_KEY = bytes('old-content-key');

const makeCrypto = () => ({
  randomKey: vi.fn(() => NEW_KEY),
  createSealedBox: vi.fn((message: Uint8Array, publicKey: Uint8Array) =>
    bytes(`sealed[${text(message)}|to:${text(publicKey)}]`),
  ),
  secretBox: vi.fn((message: Uint8Array, key: Uint8Array) =>
    bytes(`boxed[${text(message)}|with:${text(key)}]`),
  ),
  openSecretBox: vi.fn((box: Uint8Array, key: Uint8Array) => {
    if (text(key) !== text(OLD_KEY)) {
      throw new Error('wrong key');
    }
    return bytes(`opened[${text(box)}]`);
  }),
});

const projectData = ProjectData.parse({
  name: 'Case Alpha',
  description: '',
  icon: 'folder',
  color: 'slate',
});

const makeProject = (overrides: Partial<Project['record']> = {}): Project => ({
  record: {
    id: 'proj_1',
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-02T00:00:00Z',
    data: 'encrypted-blob',
    creator: 'user_creator',
    key_version: 1,
    organisation: 'org_1',
    ...overrides,
  },
  decryptedData: projectData,
  contentKey: OLD_KEY,
});

const participant = (userId: string, role = 'Editor') => ({
  id: `pp_${userId}`,
  project: 'proj_1',
  user_id: userId,
  role: role as 'Admin' | 'Editor' | 'Viewer',
  added_at: '2026-01-01T00:00:00Z',
});

const conversation = (id: string) => ({
  id,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
  data: 'conv-data',
  project: 'proj_1',
  key_version: 1,
  project_key_version: 1,
  wrapped_conversation_secret_key: Base64.fromUint8Array(bytes(`convkey-${id}`)),
});

describe('ProjectSharingService', () => {
  let api: {
    getUserPublicKey: ReturnType<typeof vi.fn>;
    listProjectParticipants: ReturnType<typeof vi.fn>;
    addProjectParticipant: ReturnType<typeof vi.fn>;
    removeProjectParticipant: ReturnType<typeof vi.fn>;
    rotateProjectKey: ReturnType<typeof vi.fn>;
    listProjectConversations: ReturnType<typeof vi.fn>;
    updateProject: ReturnType<typeof vi.fn>;
    listProjectMemory: ReturnType<typeof vi.fn>;
    updateProjectMemory: ReturnType<typeof vi.fn>;
  };
  let crypto: ReturnType<typeof makeCrypto>;
  let applyKeyRotation: ReturnType<typeof vi.fn>;

  const build = (): ProjectSharingService => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ProjectSharingService,
        { provide: CognosApiService, useValue: api },
        { provide: CryptoService, useValue: crypto },
        { provide: ProjectService, useValue: { applyKeyRotation } },
      ],
    });
    return TestBed.inject(ProjectSharingService);
  };

  beforeEach(() => {
    crypto = makeCrypto();
    applyKeyRotation = vi.fn();
    api = {
      getUserPublicKey: vi.fn((userId: string) =>
        of({ public_key: Base64.fromUint8Array(bytes(`pk-${userId}`)) }),
      ),
      listProjectParticipants: vi.fn(() =>
        of([
          participant('user_creator', 'Admin'),
          participant('user_b'),
          participant('user_c', 'Viewer'),
        ]),
      ),
      addProjectParticipant: vi.fn(() => of(participant('user_new'))),
      removeProjectParticipant: vi.fn(() => of(undefined)),
      rotateProjectKey: vi.fn(() =>
        of({
          project_id: 'proj_1',
          key_version: 2,
          wrapped_project_keys: [],
          rewrapped_conversation_keys: [],
        }),
      ),
      listProjectConversations: vi.fn(() =>
        of([conversation('conv_1'), conversation('conv_2')]),
      ),
      updateProject: vi.fn(() =>
        of({ ...makeProject().record, key_version: 2, data: 'rewrapped-blob' }),
      ),
      listProjectMemory: vi.fn(() => of([])),
      updateProjectMemory: vi.fn((id: string, data: string) => of({ id, data })),
    };
  });

  // ---- addParticipant --------------------------------------------------------

  it('wraps the CURRENT project content key to the target public key and posts it', async () => {
    const service = build();

    await firstValueFrom(service.addParticipant(makeProject(), 'user_new', 'Editor'));

    expect(api.getUserPublicKey).toHaveBeenCalledWith('user_new');
    expect(api.addProjectParticipant).toHaveBeenCalledWith('proj_1', {
      user_id: 'user_new',
      role: 'Editor',
      wrapped_project_key: Base64.fromUint8Array(
        bytes('sealed[old-content-key|to:pk-user_new]'),
      ),
    });
  });

  it('does not add a participant when the public key lookup fails', async () => {
    api.getUserPublicKey = vi.fn(() => throwError(() => new Error('404')));
    const service = build();

    await expect(
      firstValueFrom(service.addParticipant(makeProject(), 'user_new', 'Editor')),
    ).rejects.toThrow();
    expect(api.addProjectParticipant).not.toHaveBeenCalled();
  });

  // ---- rotateKey: the completeness rule --------------------------------------

  it('covers every remaining participant and every conversation in the rotate payload', async () => {
    const service = build();

    const phases = await lastValueFrom(
      service.rotateKey(makeProject()).pipe(toArray()),
    );
    expect(phases).toEqual(['preparing', 'rotating', 'finalising', 'done']);

    expect(api.rotateProjectKey).toHaveBeenCalledTimes(1);
    const [projectId, request] = api.rotateProjectKey.mock.calls[0];
    expect(projectId).toBe('proj_1');
    expect(request.new_key_version).toBe(2);

    // Completeness: one fresh wrapping per active participant, no misses, no
    // extras — the server would reject anything else, but the client must
    // already build it right.
    const wrappedFor = request.wrapped_project_keys.map(
      (entry: { user_id: string }) => entry.user_id,
    );
    expect([...wrappedFor].sort()).toEqual(['user_b', 'user_c', 'user_creator']);
    for (const entry of request.wrapped_project_keys) {
      expect(text(Base64.toUint8Array(entry.wrapped_project_key))).toBe(
        `sealed[new-content-key|to:pk-${entry.user_id}]`,
      );
    }

    // Completeness: every project conversation's secret key is rewrapped
    // under the NEW key (unwrapped with the old one first).
    const rewrapped = request.rewrapped_conversation_keys.map(
      (entry: { conversation_id: string }) => entry.conversation_id,
    );
    expect([...rewrapped].sort()).toEqual(['conv_1', 'conv_2']);
    for (const entry of request.rewrapped_conversation_keys) {
      expect(text(Base64.toUint8Array(entry.wrapped_secret_key))).toBe(
        `boxed[opened[convkey-${entry.conversation_id}]|with:new-content-key]`,
      );
    }
  });

  it('re-encrypts the project data under the new key and updates local state', async () => {
    const service = build();

    await lastValueFrom(service.rotateKey(makeProject()));

    expect(api.updateProject).toHaveBeenCalledTimes(1);
    const [, updateRequest] = api.updateProject.mock.calls[0];
    const blob = text(Base64.toUint8Array(updateRequest.data));
    expect(blob).toContain('|with:new-content-key]');

    expect(applyKeyRotation).toHaveBeenCalledWith(
      'proj_1',
      NEW_KEY,
      expect.objectContaining({ key_version: 2 }),
    );
  });

  it('migrates project memory records that open with the old key and skips the rest', async () => {
    api.listProjectMemory = vi.fn(() =>
      of([
        {
          id: 'mem_1',
          data: Base64.fromUint8Array(bytes('memory-blob')),
          created: '',
          updated: '',
        },
        {
          id: 'mem_2',
          data: Base64.fromUint8Array(bytes('already-migrated')),
          created: '',
          updated: '',
        },
      ]),
    );
    // mem_2 no longer opens with the old key (e.g. migrated by an earlier
    // finalise retry) — it must be skipped, never fail the rotation.
    crypto.openSecretBox = vi.fn((box: Uint8Array, key: Uint8Array) => {
      if (text(box) === 'already-migrated') {
        throw new Error('wrong key');
      }
      if (text(key) !== text(OLD_KEY)) {
        throw new Error('wrong key');
      }
      return bytes(`opened[${text(box)}]`);
    });
    const service = build();

    const phases = await lastValueFrom(
      service.rotateKey(makeProject()).pipe(toArray()),
    );
    expect(phases[phases.length - 1]).toBe('done');

    expect(api.updateProjectMemory).toHaveBeenCalledTimes(1);
    const [memoryId, memoryData] = api.updateProjectMemory.mock.calls[0];
    expect(memoryId).toBe('mem_1');
    expect(text(Base64.toUint8Array(memoryData))).toBe(
      'boxed[opened[memory-blob]|with:new-content-key]',
    );
  });

  it('handles a project with no conversations (empty rewrap list)', async () => {
    api.listProjectConversations = vi.fn(() => of([]));
    const service = build();

    await lastValueFrom(service.rotateKey(makeProject()));

    const [, request] = api.rotateProjectKey.mock.calls[0];
    expect(request.rewrapped_conversation_keys).toEqual([]);
  });

  // ---- rotateKey: failure honesty --------------------------------------------

  it('fails with phase "preparing" (old key valid, server untouched) when a public key is missing', async () => {
    api.getUserPublicKey = vi.fn((userId: string) =>
      userId === 'user_c'
        ? throwError(() => new Error('404'))
        : of({ public_key: Base64.fromUint8Array(bytes(`pk-${userId}`)) }),
    );
    const service = build();

    await expect(lastValueFrom(service.rotateKey(makeProject()))).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProjectRotationError && error.phase === 'preparing',
    );
    expect(api.rotateProjectKey).not.toHaveBeenCalled();
    expect(api.updateProject).not.toHaveBeenCalled();
  });

  it('fails with phase "rotating" (old key still valid) when the commit is rejected', async () => {
    api.rotateProjectKey = vi.fn(() => throwError(() => new Error('409')));
    const service = build();

    await expect(lastValueFrom(service.rotateKey(makeProject()))).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProjectRotationError && error.phase === 'rotating',
    );
    expect(api.updateProject).not.toHaveBeenCalled();
    expect(applyKeyRotation).not.toHaveBeenCalled();
    expect(service.hasPendingFinalise('proj_1')).toBe(false);
  });

  it('fails with phase "finalising" after a committed rotation and offers a retry', async () => {
    api.updateProject = vi.fn(() => throwError(() => new Error('offline')));
    const service = build();

    await expect(lastValueFrom(service.rotateKey(makeProject()))).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProjectRotationError && error.phase === 'finalising',
    );
    // The commit DID happen — the retry path must finish the metadata work.
    expect(service.hasPendingFinalise('proj_1')).toBe(true);

    api.updateProject = vi.fn(() =>
      of({ ...makeProject().record, key_version: 2, data: 'rewrapped-blob' }),
    );
    const phases = await lastValueFrom(
      service.retryFinalise(makeProject()).pipe(toArray()),
    );
    expect(phases).toEqual(['finalising', 'done']);
    expect(applyKeyRotation).toHaveBeenCalledTimes(1);
    expect(service.hasPendingFinalise('proj_1')).toBe(false);
  });

  it('rejects retryFinalise when no rotation is pending for the project', async () => {
    const service = build();

    await expect(lastValueFrom(service.retryFinalise(makeProject()))).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProjectRotationError && error.phase === 'finalising',
    );
  });
});
