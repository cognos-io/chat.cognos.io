import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RedactedMarkdownComponent } from '@app/components/chat/redacted-markdown/redacted-markdown.component';
import { CogDocBlock } from '@app/documents/cog-doc/cog-doc.types';
import { DocumentExportService } from '@app/documents/document-export.service';
import { Message } from '@app/interfaces/message';

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

describe('DocumentCardComponent', () => {
  let fixture: ComponentFixture<DocumentCardComponent>;
  const downloadCogDoc = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    downloadCogDoc.mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [DocumentCardComponent],
      providers: [{ provide: DocumentExportService, useValue: { downloadCogDoc } }],
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

  it('shows the plain uppercase format tag, untranslated', () => {
    setBlock(buildBlock({ spec: { format: 'pdf' } }));

    expect(
      fixture.nativeElement.querySelector('.document-card__format').textContent.trim(),
    ).toBe('PDF');
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
});
