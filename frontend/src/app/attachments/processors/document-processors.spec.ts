import { describe, expect, it, vi } from 'vitest';

import { detectFileType } from '../attachment-type-detection';
import { ProcessorInput, defaultAttachmentLimits } from '../attachment.types';
import { DocxProcessor } from './docx.processor';
import { PdfProcessor } from './pdf.processor';
import { TextExtractor } from './text-extraction';

const inputFor = (
  fileName: string,
  mime = '',
  limits = defaultAttachmentLimits(),
): ProcessorInput => ({
  fileName,
  bytes: Uint8Array.from([1, 2, 3]),
  detectedType: detectFileType(fileName, mime),
  limits,
});

describe('document processors (injected extractors)', () => {
  describe('PdfProcessor', () => {
    // A fake OCR extractor that fails the test if it is ever invoked — used to
    // pin that the text-layer path never triggers the (expensive) OCR fallback.
    const ocrShouldNotRun: TextExtractor = async () => {
      throw new Error('OCR must not run when the text layer has text');
    };

    it('accepts pdf by extension and mime', () => {
      const p = new PdfProcessor(async () => 'x', ocrShouldNotRun);
      expect(p.canProcess(inputFor('report.pdf'))).toBe(true);
      expect(p.canProcess(inputFor('blob', 'application/pdf'))).toBe(true);
      expect(p.canProcess(inputFor('notes.txt'))).toBe(false);
    });

    it('extracts text into an extracted_text artifact + context', async () => {
      const p = new PdfProcessor(async () => 'page one\fpage two', ocrShouldNotRun);
      const out = await p.process(inputFor('report.pdf'));
      expect(out.artifacts[0].kind).toBe('extracted_text');
      expect(out.ai.hasTextContext).toBe(true);
      expect(out.ai.textContext).toContain('page one');
    });

    it('does not invoke OCR when the text layer yields text', async () => {
      const ocr = vi.fn<TextExtractor>(async () => 'ocr text');
      const p = new PdfProcessor(async () => 'real text', ocr);
      const out = await p.process(inputFor('report.pdf'));
      expect(ocr).not.toHaveBeenCalled();
      expect(out.ai.textContext).toContain('real text');
    });

    it('falls back to OCR when the text layer is empty (scanned pdf)', async () => {
      const ocr = vi.fn<TextExtractor>(async () => 'text from ocr');
      const p = new PdfProcessor(async () => '   ', ocr);
      const out = await p.process(inputFor('scan.pdf'));
      expect(ocr).toHaveBeenCalledTimes(1);
      expect(out.ai.hasTextContext).toBe(true);
      expect(out.ai.textContext).toContain('text from ocr');
    });

    it('fails closed when both the text layer and OCR find nothing', async () => {
      const p = new PdfProcessor(
        async () => '   ',
        async () => '',
      );
      await expect(p.process(inputFor('scan.pdf'))).rejects.toMatchObject({
        code: 'no_text_extracted',
      });
    });

    it('maps a library failure to processing_failed', async () => {
      const p = new PdfProcessor(async () => {
        throw new Error('boom');
      }, ocrShouldNotRun);
      await expect(p.process(inputFor('bad.pdf'))).rejects.toMatchObject({
        code: 'processing_failed',
      });
    });
  });

  describe('DocxProcessor', () => {
    it('accepts only .docx (not legacy .doc)', () => {
      const p = new DocxProcessor(async () => 'x');
      expect(p.canProcess(inputFor('memo.docx'))).toBe(true);
      expect(p.canProcess(inputFor('memo.doc'))).toBe(false);
    });

    it('extracts text', async () => {
      const p = new DocxProcessor(async () => 'hello from docx');
      const out = await p.process(inputFor('memo.docx'));
      expect(out.ai.textContext).toBe('hello from docx');
    });
  });
});
