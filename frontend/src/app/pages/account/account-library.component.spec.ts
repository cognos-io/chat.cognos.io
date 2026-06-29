import { Dialog } from '@angular/cdk/dialog';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { of, throwError } from 'rxjs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CognosToastService } from '@cognos/ui-angular';

import {
  AttachmentLibraryService,
  LibraryFile,
} from '@app/attachments/attachment-library.service';
import { AttachmentUsage } from '@app/attachments/attachment-upload.service';
import { ConversationService } from '@app/services/conversation.service';
import { DeviceService } from '@app/services/device.service';
import { VaultService } from '@app/services/vault.service';

import { AccountLibraryComponent } from './account-library.component';

/** Build a minimal LibraryFile — only the fields the component reads matter. */
function libraryFile(
  id: string,
  displayName: string,
  overrides: Partial<LibraryFile> = {},
): LibraryFile {
  return {
    id,
    displayName,
    mimeType: 'text/plain',
    sizeBytes: 2048,
    plaintextHash: '',
    createdAt: '2026-01-15T10:00:00Z',
    hasTextContext: true,
    manifest: {} as LibraryFile['manifest'],
    record: {} as LibraryFile['record'],
    ...overrides,
  };
}

function usage(conversation: string, message: string): AttachmentUsage {
  return { conversation, message, created: '2026-01-15T10:00:00Z' };
}

describe('AccountLibraryComponent', () => {
  let fixture: ComponentFixture<AccountLibraryComponent>;
  let component: AccountLibraryComponent;

  const files = signal<LibraryFile[]>([]);
  const keyPair = signal<unknown>({
    publicKey: new Uint8Array(),
    secretKey: new Uint8Array(),
  });
  const conversationList = signal<
    Array<{ record: { id: string }; decryptedData: { title: string } }>
  >([]);

  const usagesMap: Record<string, AttachmentUsage[]> = {};
  let dialogConfirm: boolean;

  const library = {
    files,
    refresh: vi.fn(() => of(files())),
    usages: vi.fn((id: string) => of(usagesMap[id] ?? [])),
    rename: vi.fn(() => of([])),
    remove: vi.fn(() => of([])),
    download: vi.fn(() => Promise.resolve()),
  };
  const toast = { notify: vi.fn() };
  const dialog = { open: vi.fn(() => ({ closed: of(dialogConfirm) })) };

  async function render() {
    await TestBed.configureTestingModule({
      imports: [AccountLibraryComponent],
      providers: [
        provideRouter([]),
        { provide: AttachmentLibraryService, useValue: library },
        { provide: VaultService, useValue: { keyPair } },
        { provide: DeviceService, useValue: { isMobile: signal(false) } },
        { provide: ConversationService, useValue: { conversationList } },
        { provide: CognosToastService, useValue: toast },
        { provide: Dialog, useValue: dialog },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountLibraryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => {
    files.set([]);
    keyPair.set({ publicKey: new Uint8Array(), secretKey: new Uint8Array() });
    conversationList.set([]);
    for (const key of Object.keys(usagesMap)) delete usagesMap[key];
    dialogConfirm = true;
    vi.clearAllMocks();
  });

  // ---- Sunny: rendering + eager usage load ----------------------------------

  it('shows the empty state when there are no files', async () => {
    await render();
    expect(fixture.nativeElement.textContent).toContain('No files in your library yet');
    expect(
      fixture.nativeElement.querySelector('[data-testid="library-page-list"]'),
    ).toBeNull();
  });

  it('eagerly loads usages for every file on unlock and renders the grid', async () => {
    files.set([libraryFile('f1', 'notes.txt'), libraryFile('f2', 'sheet.csv')]);
    usagesMap['f1'] = [usage('c1', 'm1')];
    await render();

    expect(library.refresh).toHaveBeenCalled();
    expect(library.usages).toHaveBeenCalledWith('f1');
    expect(library.usages).toHaveBeenCalledWith('f2');
    expect(
      fixture.nativeElement.querySelector('[data-testid="library-page-list"]'),
    ).not.toBeNull();
  });

  // ---- Filtering: query + kind ----------------------------------------------

  it('filters by search query (case-insensitive)', async () => {
    files.set([libraryFile('f1', 'Tenancy.pdf'), libraryFile('f2', 'Budget.csv')]);
    await render();

    component.query.set('budget');
    fixture.detectChanges();

    expect(component.rows().map((r) => r.file.id)).toEqual(['f2']);
  });

  it('filters by file kind derived from the extension', async () => {
    files.set([
      libraryFile('doc', 'a.pdf'),
      libraryFile('img', 'b.png'),
      libraryFile('sheet', 'c.csv'),
      libraryFile('audio', 'd.mp3'),
    ]);
    await render();

    component.filter.set('image');
    fixture.detectChanges();
    expect(component.rows().map((r) => r.file.id)).toEqual(['img']);

    component.filter.set('sheet');
    fixture.detectChanges();
    expect(component.rows().map((r) => r.file.id)).toEqual(['sheet']);
  });

  it('shows a "no matches" state when a search filters everything out', async () => {
    files.set([libraryFile('f1', 'notes.txt')]);
    await render();

    component.query.set('nothing-matches');
    fixture.detectChanges();

    expect(component.rows()).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('No files match your search');
  });

  // ---- Reference count: distinct chats, three display states ----------------

  it('counts distinct conversations, not raw message references', async () => {
    files.set([libraryFile('f1', 'notes.txt')]);
    await render();
    // Same conversation referenced by two different messages = one chat.
    component.usagesByFile.set({
      f1: [usage('c1', 'm1'), usage('c1', 'm2'), usage('c2', 'm3')],
    });
    fixture.detectChanges();

    const row = component.rows()[0];
    expect(row.chatCount).toBe(2);
    expect(row.refsText).toBe('In 2 chats');
    expect(row.vault.refs).toBe(2);
  });

  it('shows "Not referenced" when a file is used in no chats', async () => {
    files.set([libraryFile('f1', 'notes.txt')]);
    await render();
    component.usagesByFile.set({ f1: [] });
    fixture.detectChanges();

    expect(component.rows()[0].refsText).toBe('Not referenced');
    expect(component.rows()[0].chatCount).toBe(0);
  });

  it('hides the reference line until the count is known', async () => {
    files.set([libraryFile('f1', 'notes.txt')]);
    keyPair.set(null); // suppress the eager load so the count stays unknown
    await render();

    expect(component.rows()[0].refsText).toBe('');
    expect(component.rows()[0].chatCount).toBe(-1);
  });

  // ---- Usages view: resolves titles, dedupes, falls back --------------------

  it('resolves conversation titles for the open file and dedupes by chat', async () => {
    const file = libraryFile('f1', 'notes.txt');
    files.set([file]);
    conversationList.set([
      { record: { id: 'c1' }, decryptedData: { title: 'Lease questions' } },
      { record: { id: 'c2' }, decryptedData: { title: 'Tax help' } },
    ]);
    usagesMap['f1'] = [usage('c1', 'm1'), usage('c1', 'm2'), usage('c2', 'm3')];
    await render();

    component.openUsages(file);
    fixture.detectChanges();

    expect(component.modalView()).toBe('usages');
    expect(component.currentUsageLinks()).toEqual([
      { conversationId: 'c1', title: 'Lease questions' },
      { conversationId: 'c2', title: 'Tax help' },
    ]);
  });

  it('falls back to "Untitled chat" when a conversation is not loaded or has no title', async () => {
    const file = libraryFile('f1', 'notes.txt');
    files.set([file]);
    conversationList.set([{ record: { id: 'c1' }, decryptedData: { title: '   ' } }]);
    usagesMap['f1'] = [usage('c1', 'm1'), usage('cX', 'm2')];
    await render();

    component.openUsages(file);
    fixture.detectChanges();

    expect(component.currentUsageLinks()).toEqual([
      { conversationId: 'c1', title: 'Untitled chat' },
      { conversationId: 'cX', title: 'Untitled chat' },
    ]);
  });

  it('re-fetches usages when the usages view is opened', async () => {
    const file = libraryFile('f1', 'notes.txt');
    files.set([file]);
    await render();
    library.usages.mockClear();
    usagesMap['f1'] = [usage('c1', 'm1')];

    component.openUsages(file);

    expect(library.usages).toHaveBeenCalledWith('f1');
    expect(component.currentChatCount()).toBe(1);
  });

  // ---- Action sheet: rename ---------------------------------------------------

  it('renames a file and closes the sheet', async () => {
    const file = libraryFile('f1', 'old.txt');
    files.set([file]);
    await render();

    component.openMenu(file);
    component.startRename();
    expect(component.modalView()).toBe('rename');

    component.renameDraft.set('new.txt');
    component.commitRename();

    expect(library.rename).toHaveBeenCalledWith(file, 'new.txt');
    expect(component.menuFile()).toBeNull();
  });

  it('does not rename when the name is unchanged or blank', async () => {
    const file = libraryFile('f1', 'same.txt');
    files.set([file]);
    await render();

    component.openMenu(file);
    component.renameDraft.set('same.txt');
    component.commitRename();
    expect(library.rename).not.toHaveBeenCalled();

    component.openMenu(file);
    component.renameDraft.set('   ');
    component.commitRename();
    expect(library.rename).not.toHaveBeenCalled();
  });

  // ---- Action sheet: remove (confirm / cancel) -------------------------------

  it('removes a file after the confirmation is accepted', async () => {
    const file = libraryFile('f1', 'gone.txt');
    files.set([file]);
    await render();
    dialogConfirm = true;

    component.openMenu(file);
    await component.removeAndClose();

    expect(library.remove).toHaveBeenCalledWith('f1');
    expect(toast.notify).toHaveBeenCalled();
  });

  it('does not remove when the confirmation is cancelled', async () => {
    const file = libraryFile('f1', 'keep.txt');
    files.set([file]);
    await render();
    dialogConfirm = false;

    component.openMenu(file);
    await component.removeAndClose();

    expect(library.remove).not.toHaveBeenCalled();
  });

  // ---- Action sheet: download (rainy) ----------------------------------------

  it('swallows download errors so the UI is not left broken', async () => {
    const file = libraryFile('f1', 'dl.txt');
    files.set([file]);
    await render();
    library.download.mockRejectedValueOnce(new Error('network'));

    component.openMenu(file);
    await expect(component.downloadAndClose()).resolves.toBeUndefined();
    expect(component.menuFile()).toBeNull();
  });

  // ---- Edge: extension-less files map to the doc kind ------------------------

  it('treats a file with no extension as a document', async () => {
    files.set([libraryFile('f1', 'README')]);
    await render();

    component.filter.set('doc');
    fixture.detectChanges();
    expect(component.rows().map((r) => r.file.id)).toEqual(['f1']);
  });

  // ---- Rainy: a failing eager-load must not break the page -------------------

  it('keeps rendering when loading usages fails', async () => {
    files.set([libraryFile('f1', 'notes.txt')]);
    library.usages.mockReturnValueOnce(throwError(() => new Error('boom')));
    await render();

    expect(component.rows()).toHaveLength(1);
    expect(component.rows()[0].refsText).toBe(''); // unknown, not a crash
  });
});
