import { detectFileType } from '../attachment-type-detection';
import { ProcessorInput, defaultAttachmentLimits } from '../attachment.types';
import { TextProcessor } from './text.processor';

const bytes = (value: string): Uint8Array =>
  Uint8Array.from(new TextEncoder().encode(value));

const inputFor = (
  fileName: string,
  raw: Uint8Array,
  mime = '',
  limits = defaultAttachmentLimits(),
): ProcessorInput => ({
  fileName,
  bytes: raw,
  detectedType: detectFileType(fileName, mime),
  limits,
});

describe('TextProcessor', () => {
  const processor = new TextProcessor();

  it('accepts text-like files', () => {
    expect(processor.canProcess(inputFor('notes.txt', bytes('hi')))).toBe(true);
    expect(processor.canProcess(inputFor('data.csv', bytes('a,b')))).toBe(true);
    expect(processor.canProcess(inputFor('doc.md', bytes('# h')))).toBe(true);
    expect(processor.canProcess(inputFor('x.bin', bytes('hi')))).toBe(false);
  });

  it('extracts normalized UTF-8 text and capped context', async () => {
    const out = await processor.process(inputFor('notes.txt', bytes('line1\r\nline2')));
    expect(out.artifacts).toHaveLength(1);
    expect(out.artifacts[0].kind).toBe('extracted_text');
    expect(new TextDecoder().decode(out.artifacts[0].bytes)).toBe('line1\nline2');
    expect(out.ai.hasTextContext).toBe(true);
    expect(out.ai.textContext).toBe('line1\nline2');
    expect(out.ai.textContextTruncated).toBe(false);
  });

  it('rejects invalid UTF-8', async () => {
    // 0xff is not valid UTF-8.
    await expect(
      processor.process(inputFor('bad.txt', Uint8Array.from([0xff, 0xfe]))),
    ).rejects.toThrow();
  });

  it('rejects files containing NUL bytes', async () => {
    await expect(
      processor.process(inputFor('bin.txt', Uint8Array.from([104, 0, 105]))),
    ).rejects.toThrow();
  });

  it('pretty-prints valid JSON', async () => {
    const out = await processor.process(inputFor('data.json', bytes('{"a":1,"b":2}')));
    expect(new TextDecoder().decode(out.artifacts[0].bytes)).toBe(
      '{\n  "a": 1,\n  "b": 2\n}',
    );
  });

  it('treats invalid JSON as plain text', async () => {
    const out = await processor.process(inputFor('data.json', bytes('not json')));
    expect(new TextDecoder().decode(out.artifacts[0].bytes)).toBe('not json');
  });

  it('truncates context to the per-file cap', async () => {
    const limits = { maxBytes: 1_000_000, maxContextCharsPerFile: 5 };
    const out = await processor.process(
      inputFor('big.txt', bytes('abcdefghij'), '', limits),
    );
    expect(out.ai.textContext).toBe('abcde');
    expect(out.ai.textContextTruncated).toBe(true);
    expect(out.artifacts[0].textStats?.truncated_for_context).toBe(true);
  });
});
