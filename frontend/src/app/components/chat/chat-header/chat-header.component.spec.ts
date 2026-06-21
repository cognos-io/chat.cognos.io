import { Dialog } from '@angular/cdk/dialog';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { of } from 'rxjs';

import { Base64 } from 'js-base64';

import { CognosToastService } from '@cognos/ui-angular';

import { Conversation } from '@app/interfaces/conversation';
import { KeyPair } from '@app/interfaces/key-pair';
import { Message } from '@app/interfaces/message';
import { Project } from '@app/interfaces/project';
import { AuthService } from '@app/services/auth.service';
import { ConversationService } from '@app/services/conversation.service';
import { DeviceService } from '@app/services/device.service';
import { ExportService } from '@app/services/export.service';
import { MessageService } from '@app/services/message.service';
import { ProjectService } from '@app/services/project.service';
import { PublicShareService } from '@app/services/public-share.service';
import { RedactionService } from '@app/services/redaction.service';
import { VaultService } from '@app/services/vault.service';

import { ChatHeaderComponent } from './chat-header.component';

describe('ChatHeaderComponent', () => {
  let fixture: ComponentFixture<ChatHeaderComponent>;
  let component: ChatHeaderComponent;
  let router: Router;
  let dialogOpen: ReturnType<typeof vi.fn>;

  const selectedConversation = signal<Conversation | undefined>(undefined);
  const temporaryConversation = signal(false);
  const messages = signal<Message[]>([]);
  const projects = signal<Project[]>([]);
  const keyPair = signal<KeyPair | undefined>(undefined);
  const publicKeyFingerprint = signal('');
  const email = signal('');
  const isMobile = signal(false);

  const deleteConversation$ = { next: vi.fn() };

  const conversationService = {
    conversation: selectedConversation,
    isTemporaryConversation: temporaryConversation,
    deleteConversation$,
  };

  const messageService = {
    messages,
    resetState: vi.fn(),
  };

  const vaultService = {
    keyPair,
    publicKeyFingerprint,
  };

  const authService = {
    email,
  };

  const publicShareService = {
    existingShareUrl: vi.fn().mockReturnValue(of(null)),
  };

  const redactionRevision = signal(0);
  const valuesHidden = signal(false);
  const redactionEntries = signal<Map<string, unknown>>(new Map());
  const redactionService = {
    revision: redactionRevision,
    valuesHidden,
    entriesFor: () => redactionEntries(),
    toggleValuesHidden: vi.fn(() => valuesHidden.update((h) => !h)),
  };

  const exportService = {
    downloadConversationExport: vi.fn().mockResolvedValue({ conversation_count: 1 }),
  };
  const toastService = { notify: vi.fn() };

  beforeEach(async () => {
    selectedConversation.set(undefined);
    temporaryConversation.set(false);
    messages.set([]);
    projects.set([]);
    keyPair.set(undefined);
    publicKeyFingerprint.set('');
    email.set('');
    isMobile.set(false);
    redactionRevision.set(0);
    valuesHidden.set(false);
    redactionEntries.set(new Map());
    vi.clearAllMocks();
    publicShareService.existingShareUrl.mockReturnValue(of(null));

    dialogOpen = vi.fn().mockReturnValue({ closed: of(true) });

    await TestBed.configureTestingModule({
      imports: [ChatHeaderComponent],
      providers: [
        provideRouter([]),
        { provide: ConversationService, useValue: conversationService },
        { provide: ProjectService, useValue: { projects } },
        { provide: MessageService, useValue: messageService },
        { provide: VaultService, useValue: vaultService },
        { provide: AuthService, useValue: authService },
        { provide: DeviceService, useValue: { isMobile } },
        { provide: PublicShareService, useValue: publicShareService },
        { provide: RedactionService, useValue: redactionService },
        { provide: ExportService, useValue: exportService },
        { provide: CognosToastService, useValue: toastService },
        { provide: Dialog, useValue: { open: dialogOpen } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatHeaderComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture.detectChanges();
  });

  it('falls back to "New chat" when there is no conversation', () => {
    expect(component.title()).toBe('New chat');
  });

  it('falls back to "Temporary chat" for a temporary conversation', () => {
    temporaryConversation.set(true);

    expect(component.title()).toBe('Temporary chat');
  });

  it('shows the decrypted conversation title when present', () => {
    selectedConversation.set(makeConversation('c-1', 'FOI request — draft reply'));
    fixture.detectChanges();

    expect(component.title()).toBe('FOI request — draft reply');
    expect(
      fixture.nativeElement.querySelector('.chat-header__title').textContent,
    ).toContain('FOI request — draft reply');
  });

  it('has no overflow menu for a fresh new chat', () => {
    expect(component.menuItems()).toEqual([]);
    expect(fixture.nativeElement.querySelector('.chat-header__menu-wrap')).toBeNull();
  });

  it('offers rename, export and delete for a persisted conversation', () => {
    selectedConversation.set(makeConversation('c-1', 'Saved chat'));
    fixture.detectChanges();

    const titles = component.menuItems().map((item) => item.title);

    expect(titles).toEqual(['Rename', 'Export', 'Delete']);
    expect(
      component.menuItems().find((item) => item.title === 'Export')?.disabled,
    ).toBeFalsy();
  });

  it('exports the conversation when the export action is selected', async () => {
    selectedConversation.set(makeConversation('c-1', 'Saved chat'));
    fixture.detectChanges();

    const titles = component.menuItems().map((item) => item.title);
    component.onMenuSelect(titles.indexOf('Export'));
    await Promise.resolve();

    expect(exportService.downloadConversationExport).toHaveBeenCalledTimes(1);
    expect(exportService.downloadConversationExport.mock.calls[0][0]).toBe(
      selectedConversation(),
    );
  });

  it('offers a hide/show values toggle only when the conversation has redactions', () => {
    selectedConversation.set(makeConversation('c-1', 'Saved chat'));
    fixture.detectChanges();

    // No redactions yet → no toggle.
    expect(component.menuItems().map((item) => item.title)).not.toContain(
      'Hide sensitive values',
    );

    redactionEntries.set(new Map([['[[PII_EMAIL_X]]', {}]]));
    redactionRevision.update((v) => v + 1);
    fixture.detectChanges();

    // The toggle appears, and selecting it masks the values; the label flips.
    const titles = component.menuItems().map((item) => item.title);
    expect(titles).toContain('Hide sensitive values');
    component.onMenuSelect(titles.indexOf('Hide sensitive values'));
    expect(redactionService.toggleValuesHidden).toHaveBeenCalledTimes(1);

    fixture.detectChanges();
    expect(component.menuItems().map((item) => item.title)).toContain(
      'Show sensitive values',
    );
  });

  it('adds Share to the overflow menu on mobile, where the Share button is hidden', () => {
    selectedConversation.set(makeConversation('c-1', 'Saved chat'));
    isMobile.set(true);
    fixture.detectChanges();

    expect(component.menuItems().map((item) => item.title)).toEqual([
      'Share',
      'Rename',
      'Export',
      'Delete',
    ]);

    component.onMenuSelect(0);
    expect(dialogOpen).toHaveBeenCalled();
  });

  it('warns with a Shared control when the conversation has a public link', () => {
    publicShareService.existingShareUrl.mockReturnValue(
      of('https://cognos.local/p/abc#k'),
    );
    selectedConversation.set(makeConversation('c-1', 'Saved chat'));
    fixture.detectChanges();

    expect(component.isShared()).toBe(true);
    expect(fixture.nativeElement.querySelector('.chat-header__shared')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.chat-header__share')).toBeNull();
  });

  it('renders no breadcrumb for a fresh new chat', () => {
    expect(component.breadcrumbs()).toEqual([]);
  });

  it('shows a Cognos / title breadcrumb for a standalone chat', () => {
    selectedConversation.set(makeConversation('c-1', 'Saved chat'));
    fixture.detectChanges();

    expect(component.breadcrumbs().map((b) => b.label)).toEqual([
      'Cognos',
      'Saved chat',
    ]);
    expect(component.breadcrumbs().at(-1)?.current).toBe(true);

    component.onBreadcrumb(0);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('includes the project in the breadcrumb for a project chat and links to it', () => {
    projects.set([makeProject('proj-1', 'Acme launch')]);
    selectedConversation.set(makeConversation('c-1', 'Design notes', 'proj-1'));
    fixture.detectChanges();

    expect(component.breadcrumbs().map((b) => b.label)).toEqual([
      'Cognos',
      'Acme launch',
      'Design notes',
    ]);

    component.onBreadcrumb(1);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/account/projects/proj-1');
  });

  it('disables sharing for a project conversation', () => {
    selectedConversation.set(makeConversation('c-1', 'Project chat', 'proj-1'));
    fixture.detectChanges();

    expect(component.isProjectConversation()).toBe(true);
    // The disabled, tooltip-wrapped Share control renders instead of the
    // clickable one, and invoking share is a no-op.
    expect(
      fixture.nativeElement.querySelector('.chat-header__share-wrap'),
    ).not.toBeNull();

    component.onShare();
    expect(dialogOpen).not.toHaveBeenCalled();
  });

  it('disables the Share entry in the mobile overflow menu for a project conversation', () => {
    selectedConversation.set(makeConversation('c-1', 'Project chat', 'proj-1'));
    isMobile.set(true);
    fixture.detectChanges();

    const shareItem = component.menuItems().find((item) => item.title === 'Share');
    expect(shareItem?.disabled).toBe(true);
  });

  it('offers clear messages only for a temporary conversation with messages', () => {
    temporaryConversation.set(true);
    messages.set([makeMessage('hello')]);
    fixture.detectChanges();

    expect(component.menuItems().map((item) => item.title)).toEqual(['Clear messages']);
  });

  it('formats the vault fingerprint as grouped hex when unlocked', () => {
    keyPair.set({ publicKey: new Uint8Array([1]), secretKey: new Uint8Array() });
    publicKeyFingerprint.set(
      Base64.fromUint8Array(new Uint8Array([0x9f, 0x2a, 0x7c, 0x41, 0xdd, 0x08])),
    );
    fixture.detectChanges();

    expect(component.hasDeviceKey()).toBe(true);
    expect(component.fingerprint()).toBe('9F2A · 7C41 · DD08');
  });

  it('exposes no fingerprint while the vault is locked', () => {
    keyPair.set(undefined);
    publicKeyFingerprint.set('');
    fixture.detectChanges();

    expect(component.hasDeviceKey()).toBe(false);
    expect(component.fingerprint()).toBe('');
  });

  it('hides the user avatar when there are no other people in the chat', () => {
    selectedConversation.set(makeConversation('c-1', 'Saved chat'));
    fixture.detectChanges();

    expect(component.hasOtherPeople()).toBe(false);
    expect(fixture.nativeElement.querySelector('.chat-header__avatar')).toBeNull();
  });

  it('derives avatar initials from the user email', () => {
    email.set('ewan.jones@livemap.ch');
    fixture.detectChanges();

    expect(component.currentUserName()).toBe('Ewan Jones');
  });

  it('toggles the security modal open and closed', () => {
    expect(component.securityOpen()).toBe(false);

    component.openSecurity();
    fixture.detectChanges();
    expect(component.securityOpen()).toBe(true);

    component.closeSecurity();
    expect(component.securityOpen()).toBe(false);
  });

  it('deletes the conversation after confirmation and navigates home', () => {
    selectedConversation.set(makeConversation('c-1', 'Saved chat'));
    fixture.detectChanges();

    // Delete is the last entry for a persisted conversation.
    component.onMenuSelect(component.menuItems().length - 1);

    expect(dialogOpen).toHaveBeenCalledTimes(1);
    expect(deleteConversation$.next).toHaveBeenCalledWith('c-1');
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });

  it('clears messages when the clear action is selected', () => {
    temporaryConversation.set(true);
    messages.set([makeMessage('hello')]);
    fixture.detectChanges();

    component.onMenuSelect(0);

    expect(messageService.resetState).toHaveBeenCalledTimes(1);
  });
});

function makeConversation(id: string, title: string, project?: string): Conversation {
  return {
    record: {
      id,
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-02T00:00:00.000Z',
      data: '',
      ...(project ? { project } : {}),
    },
    decryptedData: { title },
    keyPair: {
      publicKey: new Uint8Array(),
      secretKey: new Uint8Array(),
    },
  };
}

function makeProject(id: string, name: string): Project {
  return {
    record: {
      id,
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-02T00:00:00.000Z',
      data: '',
      key_version: 1,
    },
    decryptedData: { version: '1', name, description: '' },
    contentKey: new Uint8Array(),
  };
}

function makeMessage(content: string): Message {
  return {
    record_id: '1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    decryptedData: { content },
  };
}
