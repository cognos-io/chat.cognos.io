import { Dialog } from '@angular/cdk/dialog';
import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { of } from 'rxjs';

import { CognosToastService } from '@cognos/ui-angular';

import { DocumentCardComponent } from '@app/components/chat/document-card/document-card.component';
import { RedactedMarkdownComponent } from '@app/components/chat/redacted-markdown/redacted-markdown.component';
import { CogDocBlock } from '@app/documents/cog-doc/cog-doc.types';
import { DocumentExportService } from '@app/documents/document-export.service';
import { DocumentRenderError } from '@app/documents/document.types';
import { Message } from '@app/interfaces/message';
import { AuthService } from '@app/services/auth.service';
import { BookmarkService } from '@app/services/bookmark.service';
import { CompactionService } from '@app/services/compaction.service';
import { ConversationService } from '@app/services/conversation.service';
import { MessageService } from '@app/services/message.service';
import { ModelService } from '@app/services/model.service';
import { PersonaService } from '@app/services/persona.service';
import { PrivacyPanelService } from '@app/services/privacy-panel.service';
import { RedactionService } from '@app/services/redaction.service';
import { ScopedMemoryService } from '@app/services/scoped-memory.service';
import { UserPreferencesService } from '@app/services/user-preferences.service';

import { MessageListItemComponent } from './message-list-item.component';

// The real component renders through ngx-markdown's emoji plugin, which needs
// a global `joypixels` script that angular.json only loads for the app build,
// not the unit-test harness. Content rendering itself isn't under test here,
// so swap in a no-op stand-in with the same selector/inputs to keep this spec
// focused on the download action.
@Component({
  selector: 'app-redacted-markdown',
  standalone: true,
  template: '',
})
class StubRedactedMarkdownComponent {
  @Input() content = '';
  @Input() citations: unknown[] = [];
  @Input() citationAnchors: unknown[] = [];
  @Input() bookmarks: unknown[] = [];
}

// Likewise stands in for the document card so segment-rendering tests can
// assert on what block/message it received without exercising the render
// worker / DocumentExportService plumbing (covered by document-card's own spec).
@Component({
  selector: 'app-document-card',
  standalone: true,
  template: '{{ block.state }}',
})
class StubDocumentCardComponent {
  @Input() block!: CogDocBlock;
  @Input() message: unknown;
}

function buildMessage(overrides: Partial<Message> = {}): Message {
  return {
    record_id: 'msg-1',
    createdAt: new Date('2026-07-04T00:00:00Z'),
    decryptedData: { content: 'Hello world' },
    ...overrides,
  } as Message;
}

const assistantMessage = (overrides: Partial<Message> = {}) => buildMessage(overrides);

const userMessage = (overrides: Partial<Message> = {}) =>
  buildMessage({
    decryptedData: { content: 'Hi there', owner_id: 'user-1' },
    ...overrides,
  });

describe('MessageListItemComponent - download action', () => {
  let fixture: ComponentFixture<MessageListItemComponent>;
  let component: MessageListItemComponent;
  const downloadMessageAs = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    downloadMessageAs.mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [MessageListItemComponent],
      providers: [
        { provide: ModelService, useValue: { getModel: vi.fn() } },
        { provide: PersonaService, useValue: { getPersona: vi.fn() } },
        {
          provide: MessageService,
          useValue: {
            branchInfo: vi.fn(() => undefined),
            branchPointCount: vi.fn(() => 0),
            resolveAttachmentChips: vi.fn(() => of([])),
            decryptMessageImages: vi.fn(() => of([])),
            downloadAttachmentChip: vi.fn(),
            deleteMessage: vi.fn(),
            keepExpiringMessage: vi.fn(),
            regenerate: vi.fn(),
            editMessage: vi.fn(),
            previousBranch: vi.fn(),
            nextBranch: vi.fn(),
          },
        },
        {
          provide: ConversationService,
          useValue: {
            conversation: () => undefined,
            isTemporaryConversation: () => true,
          },
        },
        { provide: AuthService, useValue: { defaultRetentionDays: () => 0 } },
        { provide: UserPreferencesService, useValue: { memoryEnabled: () => false } },
        {
          provide: RedactionService,
          useValue: {
            hydrate: vi.fn((_id: unknown, content: string) => content),
            revision: () => 0,
            enabled: () => false,
            valuesHidden: () => false,
            combinedEntriesFor: () => new Map(),
          },
        },
        { provide: CompactionService, useValue: { addManualFact: vi.fn() } },
        {
          provide: ScopedMemoryService,
          useValue: { addUserFact: vi.fn(), addProjectFact: vi.fn() },
        },
        {
          provide: BookmarkService,
          useValue: { forMessage: () => [], create: vi.fn() },
        },
        { provide: CognosToastService, useValue: { notify: vi.fn() } },
        { provide: Dialog, useValue: { open: vi.fn(() => ({ closed: of(false) })) } },
        { provide: DocumentExportService, useValue: { downloadMessageAs } },
      ],
    })
      .overrideComponent(MessageListItemComponent, {
        remove: { imports: [RedactedMarkdownComponent, DocumentCardComponent] },
        add: { imports: [StubRedactedMarkdownComponent, StubDocumentCardComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MessageListItemComponent);
    component = fixture.componentInstance;
  });

  function downloadButton(): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector(
      '.message-list-item__download-wrap button',
    );
  }

  it('hides the download action for a user message', () => {
    component.message = userMessage();
    fixture.detectChanges();

    expect(downloadButton()).toBeNull();
  });

  it('hides the download action while the assistant message is streaming', () => {
    component.message = assistantMessage({ isStreaming: true });
    fixture.detectChanges();

    expect(downloadButton()).toBeNull();
  });

  it('hides the download action for a deleted message', () => {
    component.message = assistantMessage({
      decryptedData: { content: null, deleted: true },
    });
    fixture.detectChanges();

    expect(downloadButton()).toBeNull();
  });

  it('hides the download action when the message has no content', () => {
    component.message = assistantMessage({ decryptedData: { content: '' } });
    fixture.detectChanges();

    expect(downloadButton()).toBeNull();
  });

  it('shows the download action for a completed assistant message', () => {
    component.message = assistantMessage();
    fixture.detectChanges();

    expect(downloadButton()).not.toBeNull();
  });

  it('opens a menu with three format options', async () => {
    component.message = assistantMessage();
    fixture.detectChanges();

    downloadButton()?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll(
      '.message-list-item__download-menu [role="menuitem"]',
    );
    expect(items.length).toBe(3);
    expect(items[0].textContent).toContain('Word document (.docx)');
    expect(items[1].textContent).toContain('PDF (.pdf)');
    expect(items[2].textContent).toContain('Markdown (.md)');
  });

  it.each([
    [0, 'docx'],
    [1, 'pdf'],
    [2, 'markdown'],
  ] as const)('selecting index %i downloads as %s', async (index, format) => {
    const message = assistantMessage();
    component.message = message;
    fixture.detectChanges();

    component.onDownloadSelect(index);
    await Promise.resolve();

    expect(downloadMessageAs).toHaveBeenCalledWith(message, format);
    expect(component.downloadMenuOpen()).toBe(false);
  });

  it('shows the localised failure feedback when the export rejects', async () => {
    downloadMessageAs.mockRejectedValue(
      new DocumentRenderError('render_failed', 'boom'),
    );
    component.message = assistantMessage();
    fixture.detectChanges();

    component.onDownloadSelect(0);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(component.downloadFailed()).toBe(true);
    expect(downloadButton()?.title).toBe("Couldn't create the file. Please try again.");
  });

  it('ignores a second selection while an export is in flight', async () => {
    let resolveFirst: () => void = () => undefined;
    downloadMessageAs.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    component.message = assistantMessage();
    fixture.detectChanges();

    component.onDownloadSelect(0);
    expect(component.exporting()).toBe(true);

    component.onDownloadSelect(1);
    resolveFirst();
    await Promise.resolve();
    await Promise.resolve();

    expect(downloadMessageAs).toHaveBeenCalledTimes(1);
    expect(downloadMessageAs).toHaveBeenCalledWith(component.message, 'docx');
  });
});

describe('MessageListItemComponent - document segment rendering', () => {
  let fixture: ComponentFixture<MessageListItemComponent>;
  let component: MessageListItemComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MessageListItemComponent],
      providers: [
        { provide: ModelService, useValue: { getModel: vi.fn() } },
        { provide: PersonaService, useValue: { getPersona: vi.fn() } },
        {
          provide: MessageService,
          useValue: {
            branchInfo: vi.fn(() => undefined),
            branchPointCount: vi.fn(() => 0),
            resolveAttachmentChips: vi.fn(() => of([])),
            decryptMessageImages: vi.fn(() => of([])),
          },
        },
        {
          provide: ConversationService,
          useValue: {
            conversation: () => undefined,
            isTemporaryConversation: () => true,
          },
        },
        { provide: AuthService, useValue: { defaultRetentionDays: () => 0 } },
        { provide: UserPreferencesService, useValue: { memoryEnabled: () => false } },
        {
          provide: RedactionService,
          useValue: {
            hydrate: vi.fn((_id: unknown, content: string) => content),
            revision: () => 0,
            enabled: () => false,
            valuesHidden: () => false,
            combinedEntriesFor: () => new Map(),
          },
        },
        { provide: CompactionService, useValue: { addManualFact: vi.fn() } },
        {
          provide: ScopedMemoryService,
          useValue: { addUserFact: vi.fn(), addProjectFact: vi.fn() },
        },
        {
          provide: BookmarkService,
          useValue: { forMessage: () => [], create: vi.fn() },
        },
        { provide: CognosToastService, useValue: { notify: vi.fn() } },
        { provide: Dialog, useValue: { open: vi.fn(() => ({ closed: of(false) })) } },
        { provide: DocumentExportService, useValue: { downloadCogDoc: vi.fn() } },
      ],
    })
      .overrideComponent(MessageListItemComponent, {
        remove: { imports: [RedactedMarkdownComponent, DocumentCardComponent] },
        add: { imports: [StubRedactedMarkdownComponent, StubDocumentCardComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MessageListItemComponent);
    component = fixture.componentInstance;
  });

  function markdownStubs(): StubRedactedMarkdownComponent[] {
    return fixture.debugElement
      .queryAll(By.directive(StubRedactedMarkdownComponent))
      .map((el) => el.componentInstance as StubRedactedMarkdownComponent);
  }

  function documentCardStubs(): StubDocumentCardComponent[] {
    return fixture.debugElement
      .queryAll(By.directive(StubDocumentCardComponent))
      .map((el) => el.componentInstance as StubDocumentCardComponent);
  }

  it("pin: a plain-text message (single markdown segment) renders exactly today's path", () => {
    component.message = assistantMessage({
      decryptedData: {
        content: 'Hello world',
        citations: [{ url: 'https://example.com', title: 'Example' }],
        citation_anchors: [{ citation: 0, start: 0, end: 5 }],
      },
    });
    fixture.detectChanges();

    expect(documentCardStubs().length).toBe(0);
    const markdown = markdownStubs();
    expect(markdown.length).toBe(1);
    expect(markdown[0].content).toBe('Hello world');
    // The single-segment fast path is the only one that still hydrates inline
    // citation markers, since offsets safely index the whole (unsegmented) content.
    expect(markdown[0].citationAnchors).toEqual([{ citation: 0, start: 0, end: 5 }]);
  });

  it('renders a document card for a closed, valid <cog-doc> block', () => {
    component.message = assistantMessage({
      decryptedData: {
        content: `<cog-doc spec='{"format":"docx","title":"Report"}'>\n# Report\n\nBody\n</cog-doc>`,
      },
    });
    fixture.detectChanges();

    const cards = documentCardStubs();
    expect(cards.length).toBe(1);
    expect(cards[0].block.state).toBe('ready');
    expect(cards[0].block.spec?.title).toBe('Report');
    expect(cards[0].message).toBe(component.message);
  });

  it('shows the streaming state on an in-progress <cog-doc> block', () => {
    component.message = assistantMessage({
      isStreaming: true,
      decryptedData: {
        content: `<cog-doc spec='{"format":"docx"}'>\nStill writing…`,
      },
    });
    fixture.detectChanges();

    const cards = documentCardStubs();
    expect(cards.length).toBe(1);
    expect(cards[0].block.state).toBe('streaming');
  });

  it('falls open to markdown + a note for an invalid (unparsable spec) block', () => {
    component.message = assistantMessage({
      decryptedData: {
        content: `<cog-doc broken>\nBody\n</cog-doc>`,
      },
    });
    fixture.detectChanges();

    expect(documentCardStubs().length).toBe(0);
    const markdown = markdownStubs();
    expect(markdown.length).toBe(1);
    expect(markdown[0].content).toContain('<cog-doc broken>');
    expect(fixture.nativeElement.textContent).toContain(
      "Couldn't build this file — showing its content instead.",
    );
  });

  it('suppresses inline citation anchors once segmentation is active, keeping the sources dropdown', () => {
    component.message = assistantMessage({
      decryptedData: {
        content: `Intro text.\n\n<cog-doc spec='{"format":"docx"}'>\n# Report\n\nBody\n</cog-doc>`,
        citations: [{ url: 'https://example.com', title: 'Example' }],
        citation_anchors: [{ citation: 0, start: 0, end: 5 }],
      },
    });
    fixture.detectChanges();

    // Sources dropdown still lists the citation.
    expect(fixture.nativeElement.querySelector('app-message-sources')).not.toBeNull();

    const markdown = markdownStubs();
    expect(markdown.length).toBe(1);
    expect(markdown[0].content).toBe('Intro text.\n\n');
    // No citationAnchors binding for segmented markdown — the stub's default
    // (empty array) proves the input was never bound to the real anchors.
    expect(markdown[0].citationAnchors).toEqual([]);

    expect(documentCardStubs().length).toBe(1);
  });
});

describe('MessageListItemComponent - privacy shield action', () => {
  let fixture: ComponentFixture<MessageListItemComponent>;
  let component: MessageListItemComponent;
  let privacyPanel: PrivacyPanelService;

  const testModel = {
    id: 'model-1',
    name: 'Nemotron 3 Nano Omni',
    displayName: 'Nemotron 3 Nano Omni',
    slug: 'nemotron',
    providerId: 'provider-1',
    providerName: 'NVIDIA',
    description: '',
    privacyTier: 'eu' as const,
    inputContextLength: 8192,
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MessageListItemComponent],
      providers: [
        { provide: ModelService, useValue: { getModel: () => testModel } },
        { provide: PersonaService, useValue: { getPersona: vi.fn() } },
        {
          provide: MessageService,
          useValue: {
            branchInfo: vi.fn(() => undefined),
            branchPointCount: vi.fn(() => 0),
            resolveAttachmentChips: vi.fn(() => of([])),
            decryptMessageImages: vi.fn(() => of([])),
          },
        },
        {
          provide: ConversationService,
          useValue: {
            conversation: () => undefined,
            isTemporaryConversation: () => true,
          },
        },
        { provide: AuthService, useValue: { defaultRetentionDays: () => 0 } },
        { provide: UserPreferencesService, useValue: { memoryEnabled: () => false } },
        {
          provide: RedactionService,
          useValue: {
            hydrate: vi.fn((_id: unknown, content: string) => content),
            revision: () => 0,
            enabled: () => false,
            valuesHidden: () => false,
            combinedEntriesFor: () => new Map(),
          },
        },
        { provide: CompactionService, useValue: { addManualFact: vi.fn() } },
        {
          provide: ScopedMemoryService,
          useValue: { addUserFact: vi.fn(), addProjectFact: vi.fn() },
        },
        {
          provide: BookmarkService,
          useValue: { forMessage: () => [], create: vi.fn() },
        },
        { provide: CognosToastService, useValue: { notify: vi.fn() } },
        { provide: Dialog, useValue: { open: vi.fn(() => ({ closed: of(false) })) } },
        { provide: DocumentExportService, useValue: { downloadMessageAs: vi.fn() } },
      ],
    })
      .overrideComponent(MessageListItemComponent, {
        remove: { imports: [RedactedMarkdownComponent, DocumentCardComponent] },
        add: { imports: [StubRedactedMarkdownComponent, StubDocumentCardComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MessageListItemComponent);
    component = fixture.componentInstance;
    privacyPanel = TestBed.inject(PrivacyPanelService);
  });

  function privacyButton(): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector(
      '.message-list-item__privacy-wrap button',
    );
  }

  it('hides the inline privacy receipt line', () => {
    component.message = assistantMessage({
      decryptedData: {
        content: 'Answer',
        model_id: 'model-1',
        served_model_name: 'Nemotron 3 Nano Omni',
        served_privacy_tier: 'eu',
      },
    });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.message-list-item__receipt'),
    ).toBeNull();
  });

  it('shows a shield action for a completed assistant message', () => {
    component.message = assistantMessage({
      decryptedData: {
        content: 'Answer',
        model_id: 'model-1',
        served_model_name: 'Nemotron 3 Nano Omni',
        served_privacy_tier: 'eu',
      },
    });
    fixture.detectChanges();

    expect(privacyButton()).not.toBeNull();
  });

  it('opens a popover with security stats when the shield is pressed', () => {
    component.message = assistantMessage({
      decryptedData: {
        content: 'Answer',
        model_id: 'model-1',
        served_model_name: 'Nemotron 3 Nano Omni',
        served_privacy_tier: 'eu',
      },
    });
    fixture.detectChanges();

    privacyButton()?.click();
    fixture.detectChanges();

    const popover = fixture.nativeElement.querySelector(
      '.message-list-item__privacy-pop',
    );
    expect(popover).not.toBeNull();
    expect(popover.textContent).toContain('Nemotron 3 Nano Omni');
    expect(popover.textContent).toContain('stored encrypted');
  });

  it('opens the privacy panel from the popover details link', () => {
    component.message = assistantMessage({
      decryptedData: {
        content: 'Answer',
        model_id: 'model-1',
        served_model_name: 'Nemotron 3 Nano Omni',
        served_privacy_tier: 'eu',
      },
    });
    fixture.detectChanges();

    privacyButton()?.click();
    fixture.detectChanges();

    const details = fixture.nativeElement.querySelector(
      '.message-list-item__privacy-details',
    ) as HTMLButtonElement;
    details.click();
    fixture.detectChanges();

    expect(privacyPanel.isOpen()).toBe(true);
    expect(component.privacyPopoverOpen()).toBe(false);
  });
});
