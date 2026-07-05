import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RedactedMarkdownComponent } from '@app/components/chat/redacted-markdown/redacted-markdown.component';
import { CogDocBlock } from '@app/documents/cog-doc/cog-doc.types';
import { DocumentExportService } from '@app/documents/document-export.service';
import { Message } from '@app/interfaces/message';
import { RedactionEntry } from '@app/redaction';
import { ConversationService } from '@app/services/conversation.service';
import { RedactionService } from '@app/services/redaction.service';

import { DocumentCardComponent } from './document-card.component';

// The real component renders through ngx-markdown's emoji plugin, which needs
// a global `joypixels` script the unit-test harness doesn't load. Content
// rendering itself isn't under test here (mirrors message-list-item.component.spec.ts).
@Component({
  selector: 'app-redacted-markdown',
  standalone: true,
  template: '{{ content }}',
})
class StubRedactedMarkdownComponent {
  @Input() content = '';
}

function buildBlock(overrides: Partial<CogDocBlock> = {}): CogDocBlock {
  return {
    state: 'ready',
    spec: { format: 'docx' },
    body: '# Report\n\nBody text.',
    raw: "<cog-doc spec='{}'>\n# Report\n\nBody text.\n</cog-doc>",
    ...overrides,
  };
}

const message = { record_id: 'msg-1', decryptedData: { content: '' } } as Message;

function redactionEntry(
  token: string,
  original: string,
  type: RedactionEntry['type'] = 'custom',
): RedactionEntry {
  return {
    version: '1',
    token,
    original,
    type,
    normalized: original,
    detector: 'manual',
  };
}

describe('DocumentCardComponent', () => {
  let fixture: ComponentFixture<DocumentCardComponent>;
  const downloadCogDoc = vi.fn();
  const saveCogDocToLibrary = vi.fn();
  // Token→entry map the RedactionService stub resolves the title against; a test
  // seeds it before setBlock to exercise title hydration.
  let redactionEntries: Map<string, RedactionEntry>;
  let valuesHidden = false;

  beforeEach(async () => {
    vi.clearAllMocks();
    downloadCogDoc.mockResolvedValue(undefined);
    saveCogDocToLibrary.mockResolvedValue(undefined);
    redactionEntries = new Map();
    valuesHidden = false;

    await TestBed.configureTestingModule({
      imports: [DocumentCardComponent],
      providers: [
        {
          provide: DocumentExportService,
          useValue: { downloadCogDoc, saveCogDocToLibrary },
        },
        {
          provide: ConversationService,
          useValue: { conversation: () => undefined },
        },
        {
          provide: RedactionService,
          useValue: {
            revision: () => 0,
            valuesHidden: () => valuesHidden,
            combinedEntriesFor: () => redactionEntries,
          },
        },
      ],
    })
      .overrideComponent(DocumentCardComponent, {
        remove: { imports: [RedactedMarkdownComponent] },
        add: { imports: [StubRedactedMarkdownComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DocumentCardComponent);
  });

  function setBlock(block: CogDocBlock): void {
    fixture.componentRef.setInput('block', block);
    fixture.componentRef.setInput('message', message);
    fixture.detectChanges();
  }

  function headerButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.document-card__header');
  }

  function downloadButton(): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector('.document-card__status button');
  }

  function saveButton(): HTMLButtonElement | null {
    return (
      fixture.nativeElement.querySelectorAll('.document-card__status button')[1] ?? null
    );
  }

  it('titles the card from spec.title first', () => {
    setBlock(buildBlock({ spec: { format: 'docx', title: 'Quarterly Report' } }));

    expect(
      fixture.nativeElement.querySelector('.document-card__title').textContent.trim(),
    ).toBe('Quarterly Report');
  });

  it('falls back to spec.filename, then the localised default name', () => {
    setBlock(buildBlock({ spec: { format: 'docx', filename: 'quarterly-report' } }));
    expect(
      fixture.nativeElement.querySelector('.document-card__title').textContent.trim(),
    ).toBe('quarterly-report');

    setBlock(buildBlock({ spec: { format: 'docx' } }));
    expect(
      fixture.nativeElement.querySelector('.document-card__title').textContent.trim(),
    ).toBe('Document');
  });

  describe('redaction placeholders in the title', () => {
    it('hydrates a known token to its real value as a pill, not the placeholder', () => {
      redactionEntries.set(
        '[[PII_CUSTOM_HM04KU]]',
        redactionEntry('[[PII_CUSTOM_HM04KU]]', 'Ada Lovelace'),
      );
      setBlock(
        buildBlock({
          spec: { format: 'pdf', title: 'Business Card - [[PII_CUSTOM_HM04KU]]' },
        }),
      );

      const title = fixture.nativeElement.querySelector('.document-card__title');
      const pill = title.querySelector('cog-redacted-text');
      expect(pill).not.toBeNull();
      // The real value is shown; the raw placeholder token never leaks to the UI.
      expect(title.textContent).toContain('Ada Lovelace');
      expect(title.textContent).not.toContain('[[PII_CUSTOM_HM04KU]]');
      // Plain-text portion of the title stays intact around the pill.
      expect(title.textContent).toContain('Business Card -');
    });

    it('leaves an unknown token as plain placeholder text (no pill)', () => {
      // Nothing seeded in redactionEntries → the token maps to nothing.
      setBlock(
        buildBlock({ spec: { format: 'pdf', title: 'Card - [[PII_CUSTOM_ZZZZZZ]]' } }),
      );

      const title = fixture.nativeElement.querySelector('.document-card__title');
      expect(title.querySelector('cog-redacted-text')).toBeNull();
      expect(title.textContent).toContain('[[PII_CUSTOM_ZZZZZZ]]');
    });

    it('renders a token-free title as plain text', () => {
      setBlock(buildBlock({ spec: { format: 'docx', title: 'Quarterly Report' } }));

      const title = fixture.nativeElement.querySelector('.document-card__title');
      expect(title.querySelector('cog-redacted-text')).toBeNull();
      expect(title.textContent.trim()).toBe('Quarterly Report');
    });
  });

  it('shows the plain uppercase format tag, untranslated', () => {
    setBlock(buildBlock({ spec: { format: 'pdf' } }));

    expect(
      fixture.nativeElement.querySelector('.document-card__format').textContent.trim(),
    ).toBe('PDF');
  });

  it('shows XLSX as the format tag for spreadsheet documents', () => {
    setBlock(buildBlock({ spec: { format: 'xlsx' } }));

    expect(
      fixture.nativeElement.querySelector('.document-card__format').textContent.trim(),
    ).toBe('XLSX');
  });

  it('shows the creating status while streaming, with no download button', () => {
    setBlock(buildBlock({ state: 'streaming', spec: null, body: '' }));

    expect(fixture.nativeElement.textContent).toContain('Creating document…');
    expect(downloadButton()).toBeNull();
  });

  it('shows a Download button when ready', () => {
    setBlock(buildBlock());

    expect(downloadButton()?.textContent?.trim()).toBe('Download');
  });

  it('downloads via DocumentExportService.downloadCogDoc on click', async () => {
    const block = buildBlock();
    setBlock(block);

    downloadButton()?.click();
    await Promise.resolve();

    expect(downloadCogDoc).toHaveBeenCalledWith(block, message);
  });

  it('shows a transient failure label that reverts after a couple of seconds', async () => {
    vi.useFakeTimers();
    downloadCogDoc.mockRejectedValue(new Error('boom'));
    setBlock(buildBlock());

    downloadButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    expect(downloadButton()?.textContent?.trim()).toBe(
      "Couldn't create the file. Please try again.",
    );

    await vi.advanceTimersByTimeAsync(2000);
    fixture.detectChanges();

    expect(downloadButton()?.textContent?.trim()).toBe('Download');
    vi.useRealTimers();
  });

  it('ignores a second click while a download is in flight', async () => {
    let resolveFirst: () => void = () => undefined;
    downloadCogDoc.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    setBlock(buildBlock());

    downloadButton()?.click();
    fixture.detectChanges();
    expect(downloadButton()?.disabled).toBe(true);

    downloadButton()?.click();
    resolveFirst();
    await Promise.resolve();

    expect(downloadCogDoc).toHaveBeenCalledTimes(1);
  });

  describe('save to library', () => {
    it('shows no save button while streaming', () => {
      setBlock(buildBlock({ state: 'streaming', spec: null, body: '' }));

      expect(saveButton()).toBeNull();
    });

    it('shows a Save to library button when ready', () => {
      setBlock(buildBlock());

      expect(saveButton()?.textContent?.trim()).toBe('Save to library');
    });

    it('hides the save button for xlsx blocks', () => {
      // The attachment registry accepts no spreadsheets (pinned in
      // processor-registry.spec.ts), so an xlsx save always fails closed —
      // the card must not offer a guaranteed failure (spec §5.4).
      setBlock(
        buildBlock({
          spec: { v: 1, format: 'xlsx', title: 'Sheet' },
          body: '{"sheets":[{"name":"S","rows":[["A"]]}]}',
        }),
      );

      expect(saveButton()).toBeNull();
      expect(downloadButton()).not.toBeNull();
    });

    it('calls DocumentExportService.saveCogDocToLibrary on click', async () => {
      const block = buildBlock();
      setBlock(block);

      saveButton()?.click();
      await Promise.resolve();

      expect(saveCogDocToLibrary).toHaveBeenCalledWith(block, message);
    });

    it('shows a transient success label that reverts after a couple of seconds', async () => {
      vi.useFakeTimers();
      setBlock(buildBlock());

      saveButton()?.click();
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();

      expect(saveButton()?.textContent?.trim()).toBe('Saved to library');

      await vi.advanceTimersByTimeAsync(2000);
      fixture.detectChanges();

      expect(saveButton()?.textContent?.trim()).toBe('Save to library');
      vi.useRealTimers();
    });

    it('shows a transient failure label that reverts after a couple of seconds', async () => {
      vi.useFakeTimers();
      saveCogDocToLibrary.mockRejectedValue(new Error('boom'));
      setBlock(buildBlock());

      saveButton()?.click();
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();

      expect(saveButton()?.textContent?.trim()).toBe(
        "Couldn't save the file. Please try again.",
      );

      await vi.advanceTimersByTimeAsync(2000);
      fixture.detectChanges();

      expect(saveButton()?.textContent?.trim()).toBe('Save to library');
      vi.useRealTimers();
    });

    it('ignores a second click while a save is in flight', async () => {
      let resolveFirst: () => void = () => undefined;
      saveCogDocToLibrary.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
      );
      setBlock(buildBlock());

      saveButton()?.click();
      fixture.detectChanges();
      expect(saveButton()?.disabled).toBe(true);

      saveButton()?.click();
      resolveFirst();
      await Promise.resolve();

      expect(saveCogDocToLibrary).toHaveBeenCalledTimes(1);
    });

    it('does not affect the Download button state (independent in-flight guards)', async () => {
      let resolveSave: () => void = () => undefined;
      saveCogDocToLibrary.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
      );
      setBlock(buildBlock());

      saveButton()?.click();
      fixture.detectChanges();
      expect(downloadButton()?.disabled).toBe(false);

      downloadButton()?.click();
      await Promise.resolve();
      resolveSave();

      expect(downloadCogDoc).toHaveBeenCalledTimes(1);
    });
  });

  it('collapses the preview by default and expands it on header click', () => {
    setBlock(buildBlock({ body: 'Preview body text.' }));

    expect(fixture.nativeElement.querySelector('.document-card__preview')).toBeNull();
    expect(headerButton().getAttribute('aria-expanded')).toBe('false');

    headerButton().click();
    fixture.detectChanges();

    expect(headerButton().getAttribute('aria-expanded')).toBe('true');
    const preview = fixture.nativeElement.querySelector('.document-card__preview');
    expect(preview).not.toBeNull();
    expect(preview.textContent).toContain('Preview body text.');

    headerButton().click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.document-card__preview')).toBeNull();
  });

  it('offers no preview for xlsx cards — the header is static, not expandable', () => {
    // Sheet-spec JSON is not prose; dumping it into the card is noise, not
    // help. A spreadsheet card is download-only (docx/pdf keep the preview).
    const sheetBody = '{"sheets":[{"name":"Sheet1","rows":[["A",1]]}]}';
    setBlock(buildBlock({ spec: { format: 'xlsx' }, body: sheetBody }));

    const header = headerButton();
    // Non-interactive: a plain <div>, no expand caret, no aria-expanded.
    expect(header.tagName).toBe('DIV');
    expect(header.getAttribute('aria-expanded')).toBeNull();
    expect(fixture.nativeElement.querySelector('.document-card__caret')).toBeNull();

    // Clicking it does nothing — no preview ever appears.
    header.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.document-card__preview')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-redacted-markdown')).toBeNull();
  });

  describe('formula warning line', () => {
    it('stays hidden when the download resolves with no warnings', async () => {
      downloadCogDoc.mockResolvedValue(undefined);
      setBlock(buildBlock({ spec: { format: 'xlsx' } }));

      downloadButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('cog-callout')).toBeNull();
    });

    it('shows a persistent warning line when the download resolves with warnings', async () => {
      downloadCogDoc.mockResolvedValue([
        { kind: 'ref_out_of_range', sheet: 'Sheet1', cell: 'B2', detail: 'B2' },
      ]);
      setBlock(buildBlock({ spec: { format: 'xlsx' } }));

      downloadButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();

      const callout = fixture.nativeElement.querySelector('cog-callout');
      expect(callout).not.toBeNull();
      expect(fixture.nativeElement.textContent).toContain(
        'Some formulas in this spreadsheet may need checking.',
      );

      // Persistent: unlike the transient failure label, it does not clear on
      // its own.
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('cog-callout')).not.toBeNull();
    });

    it('clears the warning line at the start of the next download', async () => {
      downloadCogDoc.mockResolvedValueOnce([
        { kind: 'ref_out_of_range', sheet: 'Sheet1', cell: 'B2', detail: 'B2' },
      ]);
      setBlock(buildBlock({ spec: { format: 'xlsx' } }));

      downloadButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('cog-callout')).not.toBeNull();

      downloadCogDoc.mockResolvedValueOnce(undefined);
      downloadButton()?.click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('cog-callout')).toBeNull();
    });
  });
});
