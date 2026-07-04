import { Dialog } from '@angular/cdk/dialog';
import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { of } from 'rxjs';

import { CognosToastService } from '@cognos/ui-angular';

import { RedactedMarkdownComponent } from '@app/components/chat/redacted-markdown/redacted-markdown.component';
import { DocumentExportService } from '@app/documents/document-export.service';
import { DocumentRenderError } from '@app/documents/document.types';
import { Message } from '@app/interfaces/message';
import { CompactionService } from '@app/services/compaction.service';
import { ConversationService } from '@app/services/conversation.service';
import { MessageService } from '@app/services/message.service';
import { ModelService } from '@app/services/model.service';
import { PersonaService } from '@app/services/persona.service';
import { RedactionService } from '@app/services/redaction.service';
import { ScopedMemoryService } from '@app/services/scoped-memory.service';

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
        { provide: CognosToastService, useValue: { notify: vi.fn() } },
        { provide: Dialog, useValue: { open: vi.fn(() => ({ closed: of(false) })) } },
        { provide: DocumentExportService, useValue: { downloadMessageAs } },
      ],
    })
      .overrideComponent(MessageListItemComponent, {
        remove: { imports: [RedactedMarkdownComponent] },
        add: { imports: [StubRedactedMarkdownComponent] },
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

  it('opens a menu with three format options', () => {
    component.message = assistantMessage();
    fixture.detectChanges();

    downloadButton()?.click();
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
