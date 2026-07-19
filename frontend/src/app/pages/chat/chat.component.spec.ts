import { Dialog } from '@angular/cdk/dialog';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { of } from 'rxjs';

import { CognosToastService } from '@cognos/ui-angular';

import { Conversation } from '@app/interfaces/conversation';
import { KeyPair } from '@app/interfaces/key-pair';
import { Message } from '@app/interfaces/message';

import { AuthService } from '../../services/auth.service';
import { BillingService } from '../../services/billing.service';
import { CompactionService } from '../../services/compaction.service';
import { ConversationDuplicateService } from '../../services/conversation-duplicate.service';
import { ConversationSearchService } from '../../services/conversation-search.service';
import { ConversationService } from '../../services/conversation.service';
import { DeviceService } from '../../services/device.service';
import { ExportService } from '../../services/export.service';
import { MessageService } from '../../services/message.service';
import { ModelService } from '../../services/model.service';
import { OrganisationService } from '../../services/organisation.service';
import { ProjectConversationService } from '../../services/project-conversation.service';
import { ProjectService } from '../../services/project.service';
import { PublicShareService } from '../../services/public-share.service';
import { RedactionService } from '../../services/redaction.service';
import { UserPreferencesService } from '../../services/user-preferences.service';
import { VaultService } from '../../services/vault.service';
import {
  buildOrgBillingContextStub,
  stubOrgBillingContext,
} from '../../testing/stub-org-billing-context';
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
  // Flips the stubbed OrganisationService between the personal workspace
  // (false) and an org workspace (true).
  const orgWorkspace = signal(false);
  const selectedConversation = signal<Conversation | undefined>(undefined);
  const pinnedConversations = signal<Conversation[]>([]);
  const recentConversations = signal<Conversation[]>([]);
  const messages = signal<Message[]>([]);

  const conversationService = {
    conversation: selectedConversation,
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

  // Fake the on-device search index: inactive by default so the sidebar renders
  // the normal Projects/Pinned/Recent navigation in these tests.
  const searchService = {
    setQuery: vi.fn(),
    isActive: signal(false),
    isHydrating: signal(false),
    showNoResults: signal(false),
    results: signal<Conversation[]>([]),
    query: signal(''),
  };

  // The conversation list items rendered for pinned/recent conversations inject
  // UserPreferencesService; stub it so the real API/PocketBase chain is not
  // constructed in the component test.
  const userPreferencesService = {
    isConversationPinned: () => false,
    pinConversation: vi.fn(),
    unpinConversation: vi.fn(),
  };

  // The chat header injects PublicShareService -> CognosApiService -> PocketBase
  // Client. Stub it so the component test does not construct that chain.
  const publicShareService = {
    existingShare: vi.fn().mockReturnValue(of(null)),
    share: vi.fn().mockReturnValue(of('')),
    revoke: vi.fn().mockReturnValue(of(undefined)),
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
    notifyUnlockPrompted: vi.fn(),
  };

  beforeEach(async () => {
    temporaryConversation.set(false);
    orgWorkspace.set(false);
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
            isPastDue: signal(false),
            orgSendBlock: signal(null),
          },
        },
        { provide: ConversationService, useValue: conversationService },
        { provide: ConversationSearchService, useValue: searchService },
        { provide: CompactionService, useValue: { compactionsFor: () => [] } },
        {
          provide: ConversationDuplicateService,
          useValue: { isDuplicatingSource: () => false, duplicate: vi.fn() },
        },
        { provide: ProjectService, useValue: { orderedProjects: signal([]) } },
        stubOrgBillingContext,
        {
          // Personal-only account by default (switcher hidden, no workspace
          // scoping); individual tests flip `orgWorkspace` to simulate an
          // active org Workspace.
          provide: OrganisationService,
          useValue: {
            memberships: signal([]),
            activeWorkspace: signal('personal'),
            hasMemberships: () => false,
            isOrgWorkspace: () => orgWorkspace(),
            activeOrg: () => null,
            visibleProjects: (projects: unknown[]) => projects,
          },
        },
        { provide: ProjectConversationService, useValue: {} },
        { provide: DeviceService, useValue: { isMobile: signal(false) } },
        { provide: MessageService, useValue: messageService },
        // The chat header injects ModelService (for the per-answer privacy
        // panel's served-model/region resolution) -> CognosApiService ->
        // PocketBase Client. Stub it so the component test does not construct
        // that chain.
        {
          provide: ModelService,
          useValue: {
            getModel: () => undefined,
            selectedModel: signal(undefined),
          },
        },
        { provide: UserPreferencesService, useValue: userPreferencesService },
        { provide: PublicShareService, useValue: publicShareService },
        {
          provide: RedactionService,
          useValue: {
            revision: signal(0),
            valuesHidden: signal(false),
            enabled: signal(true),
            entriesFor: () => new Map(),
            detect: () => [],
            customRedactionValues: () => [],
            toggleValuesHidden: vi.fn(),
          },
        },
        { provide: Dialog, useValue: { open: dialogOpen } },
        { provide: CognosToastService, useValue: toastService },
        {
          provide: ExportService,
          useValue: { downloadConversationExport: vi.fn() },
        },
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

  it('forwards search changes to the on-device search index', () => {
    component.onSearchChange('policy');

    expect(searchService.setQuery).toHaveBeenCalledWith('policy');
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

  it('shows the personal trial card in the personal workspace', () => {
    expect(fixture.nativeElement.querySelector('app-trial-credit-card')).not.toBeNull();
  });

  // Pin: inside an org Workspace the org pays, so the sidebar must never
  // nudge a member towards a personal purchase (trial upsell / PAYG usage)
  // for firm work. The card returns as soon as the personal workspace does.
  it('hides the personal trial card inside an org workspace', () => {
    orgWorkspace.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-trial-credit-card')).toBeNull();

    orgWorkspace.set(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-trial-credit-card')).not.toBeNull();
  });

  // The empty org Workspace must not be a dead end: alongside the "no
  // projects yet" note it links to the projects page where any active member
  // can create an org Project.
  it('offers a create-project link in the empty org workspace state', () => {
    orgWorkspace.set(true);
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector(
      'a.chat-shell__workspace-empty-action',
    ) as HTMLAnchorElement | null;

    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/account/projects');
  });

  it('does not show the empty-org state in the personal workspace', () => {
    expect(
      fixture.nativeElement.querySelector('.chat-shell__workspace-empty'),
    ).toBeNull();
  });
});

describe('ChatComponent org billing gates', () => {
  let fixture: ComponentFixture<ChatComponent>;

  async function mountOrgSidebar(
    orgBillingStub: ReturnType<typeof buildOrgBillingContextStub>,
  ): Promise<void> {
    TestBed.resetTestingModule();
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
            isPastDue: signal(false),
            orgSendBlock: signal(null),
          },
        },
        {
          provide: ConversationService,
          useValue: {
            conversation: signal(undefined),
            hasPinnedConversations: () => false,
            pinnedConversations: signal([]),
            hasNonPinnedConversations: () => false,
            nonPinnedConversations: signal([]),
            isTemporaryConversation: signal(false),
          },
        },
        {
          provide: ConversationSearchService,
          useValue: {
            setQuery: vi.fn(),
            isActive: signal(false),
            isHydrating: signal(false),
            showNoResults: signal(false),
            results: signal([]),
            query: signal(''),
          },
        },
        { provide: CompactionService, useValue: { compactionsFor: () => [] } },
        {
          provide: ConversationDuplicateService,
          useValue: { isDuplicatingSource: () => false, duplicate: vi.fn() },
        },
        {
          provide: ProjectService,
          useValue: { orderedProjects: signal([]), projects: signal([]) },
        },
        orgBillingStub,
        {
          provide: OrganisationService,
          useValue: {
            memberships: signal([
              { id: 'org_1', name: 'Acme', role: 'owner' as const },
            ]),
            activeWorkspace: signal('org_1'),
            hasMemberships: () => true,
            isOrgWorkspace: () => true,
            activeOrg: () => ({ id: 'org_1', name: 'Acme', role: 'owner' as const }),
            orgName: (orgId: string) => (orgId === 'org_1' ? 'Acme' : null),
            visibleProjects: (projects: unknown[]) => projects,
          },
        },
        {
          provide: ProjectConversationService,
          useValue: { byProject: () => new Map() },
        },
        { provide: DeviceService, useValue: { isMobile: signal(false) } },
        {
          provide: MessageService,
          useValue: { messages: signal([]), resetState: vi.fn() },
        },
        {
          provide: ModelService,
          useValue: { getModel: () => undefined, selectedModel: signal(undefined) },
        },
        {
          provide: UserPreferencesService,
          useValue: {
            isConversationPinned: () => false,
            pinConversation: vi.fn(),
            unpinConversation: vi.fn(),
          },
        },
        {
          provide: PublicShareService,
          useValue: {
            existingShare: vi.fn().mockReturnValue(of(null)),
            share: vi.fn().mockReturnValue(of('')),
            revoke: vi.fn().mockReturnValue(of(undefined)),
          },
        },
        {
          provide: RedactionService,
          useValue: {
            revision: signal(0),
            valuesHidden: signal(false),
            enabled: signal(true),
            entriesFor: () => new Map(),
            detect: () => [],
            customRedactionValues: () => [],
            toggleValuesHidden: vi.fn(),
          },
        },
        {
          provide: Dialog,
          useValue: { open: vi.fn().mockReturnValue({ close: vi.fn() }) },
        },
        { provide: CognosToastService, useValue: { notify: vi.fn() } },
        { provide: ExportService, useValue: { downloadConversationExport: vi.fn() } },
        {
          provide: VaultService,
          useValue: {
            keyPair: signal({
              publicKey: new Uint8Array(),
              secretKey: new Uint8Array(),
            }),
            isRestoring: signal(false),
            publicKeyFingerprint: signal(''),
            lock: vi.fn(),
            notifyUnlockPrompted: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatComponent);
    fixture.detectChanges();
  }

  it('shows the billing banner instead of create-project in an empty org workspace (rainy)', async () => {
    await mountOrgSidebar(
      buildOrgBillingContextStub({
        blocked: true,
        block: {
          code: 'ORG_BILLING_INACTIVE',
          organisationId: 'org_1',
          organisationName: 'Acme',
          message: '',
          adminMessage: '',
        },
      }),
    );

    expect(
      fixture.nativeElement.querySelector('app-org-billing-banner'),
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Acme billing is paused');
    expect(
      fixture.nativeElement.querySelector('a.chat-shell__workspace-empty-action'),
    ).toBeNull();
  });

  it('offers create-project in an empty org workspace when billing is healthy (sunny)', async () => {
    await mountOrgSidebar(buildOrgBillingContextStub({ blocked: false }));

    expect(
      fixture.nativeElement.querySelector('a.chat-shell__workspace-empty-action'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-org-billing-banner')).toBeNull();
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
