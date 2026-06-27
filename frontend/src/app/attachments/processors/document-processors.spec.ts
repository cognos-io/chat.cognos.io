import { detectFileType } from '../attachment-type-detection';
import { ProcessorInput, defaultAttachmentLimits } from '../attachment.types';
import { DocxProcessor } from './docx.processor';
import { ExcelProcessor } from './excel.processor';
import { PdfProcessor } from './pdf.processor';

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
    it('accepts pdf by extension and mime', () => {
      const p = new PdfProcessor(async () => 'x');
      expect(p.canProcess(inputFor('report.pdf'))).toBe(true);
      expect(p.canProcess(inputFor('blob', 'application/pdf'))).toBe(true);
      expect(p.canProcess(inputFor('notes.txt'))).toBe(false);
    });

    it('extracts text into an extracted_text artifact + context', async () => {
      const p = new PdfProcessor(async () => 'page one\fpage two');
      const out = await p.process(inputFor('report.pdf'));
      expect(out.artifacts[0].kind).toBe('extracted_text');
      expect(out.ai.hasTextContext).toBe(true);
      expect(out.ai.textContext).toContain('page one');
    });

    it('fails closed when no text can be extracted (e.g. scanned pdf)', async () => {
      const p = new PdfProcessor(async () => '   ');
      await expect(p.process(inputFor('scan.pdf'))).rejects.toMatchObject({
        code: 'no_text_extracted',
      });
    });

    it('maps a library failure to processing_failed', async () => {
      const p = new PdfProcessor(async () => {
        throw new Error('boom');
      });
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

  describe('ExcelProcessor', () => {
    it('accepts .xlsx and legacy .xls', () => {
      const p = new ExcelProcessor(async () => 'x');
      expect(p.canProcess(inputFor('data.xlsx'))).toBe(true);
      expect(p.canProcess(inputFor('data.xls'))).toBe(true);
      expect(p.canProcess(inputFor('data.numbers'))).toBe(false);
    });

    it('extracts sheet text', async () => {
      const p = new ExcelProcessor(async () => '# Sheet1\na,b\n1,2');
      const out = await p.process(inputFor('data.xlsx'));
      expect(out.ai.textContext).toContain('a,b');
    });

    it('truncates to the per-file context cap', async () => {
      const p = new ExcelProcessor(async () => 'x'.repeat(50));
      const out = await p.process(
        inputFor('data.xlsx', '', { maxBytes: 1_000_000, maxContextCharsPerFile: 10 }),
      );
      expect(out.ai.textContext).toHaveLength(10);
      expect(out.ai.textContextTruncated).toBe(true);
    });
  });
});
