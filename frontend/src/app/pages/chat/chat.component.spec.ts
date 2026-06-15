import { Dialog } from '@angular/cdk/dialog';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { CognosToastService } from '@cognos/ui-angular';

import { Conversation } from '@app/interfaces/conversation';
import { KeyPair } from '@app/interfaces/key-pair';
import { Message } from '@app/interfaces/message';

import { AuthService } from '../../services/auth.service';
import { BillingService } from '../../services/billing.service';
import { ConversationService } from '../../services/conversation.service';
import { DeviceService } from '../../services/device.service';
import { MessageService } from '../../services/message.service';
import { UserPreferencesService } from '../../services/user-preferences.service';
import { VaultService } from '../../services/vault.service';
import { ChatComponent } from './chat.component';

describe('ChatComponent', () => {
  let fixture: ComponentFixture<ChatComponent>;
  let component: ChatComponent;
  let router: Router;
  let dialogOpen: ReturnType<typeof vi.fn>;

  const toastService = {
    notify: vi.fn(),
  };

  const temporaryConversation = signal(false);
  const selectedConversation = signal<Conversation | undefined>(undefined);
  const pinnedConversations = signal<Conversation[]>([]);
  const recentConversations = signal<Conversation[]>([]);
  const messages = signal<Message[]>([]);

  const conversationService = {
    conversation: selectedConversation,
    filter$: { next: vi.fn() },
    hasPinnedConversations: () => pinnedConversations().length > 0,
    pinnedConversations,
    hasNonPinnedConversations: () => recentConversations().length > 0,
    nonPinnedConversations: recentConversations,
    isTemporaryConversation: temporaryConversation,
  };

  const messageService = {
    messages,
    resetState: vi.fn(),
  };

  // The conversation list items rendered for pinned/recent conversations inject
  // UserPreferencesService; stub it so the real API/PocketBase chain is not
  // constructed in the component test.
  const userPreferencesService = {
    isConversationPinned: () => false,
    pinConversation: vi.fn(),
    unpinConversation: vi.fn(),
  };

  const keyPair = signal<KeyPair | undefined>({
    publicKey: new Uint8Array(),
    secretKey: new Uint8Array(),
  });
  const isRestoring = signal(false);

  const vaultService = {
    keyPair,
    isRestoring,
    publicKeyFingerprint: signal(''),
    lock: vi.fn(),
  };

  beforeEach(async () => {
    temporaryConversation.set(false);
    selectedConversation.set(undefined);
    pinnedConversations.set([]);
    recentConversations.set([]);
    messages.set([]);
    keyPair.set({ publicKey: new Uint8Array(), secretKey: new Uint8Array() });
    isRestoring.set(false);
    vi.clearAllMocks();

    dialogOpen = vi.fn().mockReturnValue({ close: vi.fn() });

    await TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { email: signal(''), user: signal(null) } },
        {
          provide: BillingService,
          useValue: {
            planType: signal('trial'),
            balanceChf: signal(2),
            trialSeedChf: signal(2),
            isTrial: signal(true),
            isSendingLocked: signal(false),
            isTrialUsedUp: signal(false),
          },
        },
        { provide: ConversationService, useValue: conversationService },
        { provide: DeviceService, useValue: { isMobile: signal(false) } },
        { provide: MessageService, useValue: messageService },
        { provide: UserPreferencesService, useValue: userPreferencesService },
        { provide: Dialog, useValue: { open: dialogOpen } },
        { provide: CognosToastService, useValue: toastService },
        { provide: VaultService, useValue: vaultService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  });

  it('clears temporary messages and navigates to root for a new chat', () => {
    temporaryConversation.set(true);
    messages.set([
      {
        record_id: '1',
        createdAt: new Date(),
        decryptedData: { content: 'temporary message' },
      },
    ]);
    Object.defineProperty(router, 'url', { value: '/c/123', configurable: true });

    component.onNewConversation();

    expect(messageService.resetState).toHaveBeenCalledTimes(1);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('does not render breadcrumbs in the page header', () => {
    expect(fixture.nativeElement.querySelector('cog-breadcrumbs')).toBeNull();
  });

  it('does not navigate when already on the new chat route', () => {
    Object.defineProperty(router, 'url', { value: '/', configurable: true });

    component.onNewConversation();

    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('closes the drawer when an account action fires', () => {
    component.drawerOpen.set(true);

    component.closeDrawer();

    expect(component.drawerOpen()).toBe(false);
  });

  it('forwards search changes to the conversation filter', () => {
    component.onSearchChange('policy');

    expect(conversationService.filter$.next).toHaveBeenCalledWith('policy');
  });

  it('opens the unlock dialog when the key pair becomes unavailable', () => {
    keyPair.set(undefined);
    fixture.detectChanges();

    expect(dialogOpen).toHaveBeenCalledTimes(1);
  });

  it('renders a lock action with the expected tooltip copy', () => {
    component.drawerOpen.set(true);
    fixture.detectChanges();

    const lockButton = fixture.nativeElement.querySelector(
      'button[title="Locks your account and does not log you out."]',
    ) as HTMLButtonElement | null;

    expect(lockButton).not.toBeNull();
    expect(lockButton?.textContent).toContain('Lock');
  });

  it('renders only the recent section when there are no pinned conversations', () => {
    pinnedConversations.set([]);
    recentConversations.set([makeConversation('recent-1', 'Recent chat')]);
    fixture.detectChanges();

    const headings = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.chat-shell__section-heading',
      ),
    ).map((element) => element.textContent?.trim());

    expect(headings).toEqual(['Recent']);
    expect(fixture.nativeElement.textContent).toContain('Recent chat');
  });

  it('renders pinned and recent sections when both are present', () => {
    pinnedConversations.set([makeConversation('pinned-1', 'Pinned chat')]);
    recentConversations.set([makeConversation('recent-1', 'Recent chat')]);
    fixture.detectChanges();

    const headings = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.chat-shell__section-heading',
      ),
    ).map((element) => element.textContent?.trim());

    expect(headings).toEqual(['Pinned', 'Recent']);
    expect(fixture.nativeElement.textContent).toContain('Pinned chat');
    expect(fixture.nativeElement.textContent).toContain('Recent chat');
  });

  it('hides the pinned section when there are no pinned conversations', () => {
    pinnedConversations.set([]);
    recentConversations.set([makeConversation('recent-1', 'Recent chat')]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Pinned');
  });
});

function makeConversation(id: string, title: string): Conversation {
  return {
    record: {
      id,
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-02T00:00:00.000Z',
      data: '',
    },
    decryptedData: { title },
    keyPair: {
      publicKey: new Uint8Array(),
      secretKey: new Uint8Array(),
    },
  };
}
