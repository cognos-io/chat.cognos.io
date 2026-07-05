import { describe, expect, it } from 'vitest';

import {
  filenameBaseFromSpec,
  renderOptionsFromSpec,
  segmentMessageContent,
} from './cog-doc-parser';
import { COG_DOC_MAX_SOURCE_BYTES, MessageSegment } from './cog-doc.types';

describe('segmentMessageContent', () => {
  it('returns a single markdown segment on the no-sentinel fast path', () => {
    const content = 'Just a plain reply with **markdown** and no document.';

    expect(segmentMessageContent(content, { streaming: false })).toEqual<
      MessageSegment[]
    >([{ kind: 'markdown', text: content }]);
  });

  it('returns no segments for null/undefined/blank content', () => {
    expect(segmentMessageContent(null, { streaming: false })).toEqual([]);
    expect(segmentMessageContent(undefined, { streaming: false })).toEqual([]);
    expect(segmentMessageContent('   \n  ', { streaming: false })).toEqual([]);
  });

  it('parses a well-formed block into a ready document segment with trimmed body', () => {
    const content = [
      '<cog-doc spec=\'{"v":1,"format":"docx","title":"Report"}\'>',
      '# Heading',
      'Body text.',
      '</cog-doc>',
    ].join('\n');

    const segments = segmentMessageContent(content, { streaming: false });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      kind: 'document',
      block: {
        state: 'ready',
        spec: { v: 1, format: 'docx', title: 'Report' },
        body: '# Heading\nBody text.',
      },
    });
  });

  it('preserves prose before and after a block, in order', () => {
    const content = [
      'Here is your document:',
      '',
      '<cog-doc spec=\'{"format":"pdf"}\'>',
      'Body.',
      '</cog-doc>',
      '',
      'Let me know if you need changes.',
    ].join('\n');

    const segments = segmentMessageContent(content, { streaming: false });

    expect(segments.map((s) => s.kind)).toEqual(['markdown', 'document', 'markdown']);
    expect(segments[0]).toEqual({
      kind: 'markdown',
      text: 'Here is your document:\n\n',
    });
    expect((segments[2] as { kind: 'markdown'; text: string }).text).toBe(
      '\n\nLet me know if you need changes.',
    );
  });

  it('parses two blocks in a single message', () => {
    const content = [
      '<cog-doc spec=\'{"format":"docx"}\'>',
      'First body.',
      '</cog-doc>',
      'and also:',
      '<cog-doc spec=\'{"format":"pdf"}\'>',
      'Second body.',
      '</cog-doc>',
    ].join('\n');

    const segments = segmentMessageContent(content, { streaming: false });

    expect(segments.map((s) => s.kind)).toEqual(['document', 'markdown', 'document']);
    expect(
      (segments[0] as { kind: 'document'; block: { body: string } }).block.body,
    ).toBe('First body.');
    expect(
      (segments[2] as { kind: 'document'; block: { body: string } }).block.body,
    ).toBe('Second body.');
  });

  it('accepts a single-quoted spec attribute whose JSON contains escaped double quotes', () => {
    const content = [
      '<cog-doc spec=\'{"format":"docx","title":"A \\"quoted\\" word"}\'>',
      'Body.',
      '</cog-doc>',
    ].join('\n');

    const segments = segmentMessageContent(content, { streaming: false });

    expect(segments[0]).toMatchObject({
      kind: 'document',
      block: { state: 'ready', spec: { format: 'docx', title: 'A "quoted" word' } },
    });
  });

  it('marks a block invalid when the spec attribute is not valid JSON', () => {
    const content = ["<cog-doc spec='{not json}'>", 'Body.', '</cog-doc>'].join('\n');

    const segments = segmentMessageContent(content, { streaming: false });

    expect(segments[0]).toMatchObject({
      kind: 'document',
      block: { state: 'invalid', spec: null },
    });
  });

  it('marks a block invalid when the spec violates the schema (unsupported format)', () => {
    const content = [
      '<cog-doc spec=\'{"format":"pptx"}\'>',
      'Body.',
      '</cog-doc>',
    ].join('\n');

    const segments = segmentMessageContent(content, { streaming: false });

    expect(segments[0]).toMatchObject({
      kind: 'document',
      block: { state: 'invalid', spec: null },
    });
  });

  it('accepts "xlsx" as a valid format (spec §5.3) while pptx stays invalid', () => {
    const content = [
      '<cog-doc spec=\'{"format":"xlsx","title":"Revenue"}\'>',
      '{"sheets":[]}',
      '</cog-doc>',
    ].join('\n');

    const segments = segmentMessageContent(content, { streaming: false });

    expect(segments[0]).toMatchObject({
      kind: 'document',
      block: { state: 'ready', spec: { format: 'xlsx', title: 'Revenue' } },
    });
  });

  it('ignores unknown spec keys (schema strips them, forward compat)', () => {
    const content = [
      '<cog-doc spec=\'{"format":"docx","futureKey":"x"}\'>',
      'Body.',
      '</cog-doc>',
    ].join('\n');

    const segments = segmentMessageContent(content, { streaming: false });

    const block = (segments[0] as { kind: 'document'; block: { spec: unknown } }).block;
    expect(block.spec).toEqual({ format: 'docx' });
  });

  it('accepts a spec with the version field missing entirely', () => {
    const content = ['<cog-doc spec=\'{"format":"pdf"}\'>', 'Body.', '</cog-doc>'].join(
      '\n',
    );

    const segments = segmentMessageContent(content, { streaming: false });

    expect(segments[0]).toMatchObject({
      kind: 'document',
      block: { state: 'ready', spec: { format: 'pdf' } },
    });
  });

  it('treats an unterminated block as streaming with a partial body while streaming', () => {
    const content = [
      '<cog-doc spec=\'{"format":"docx"}\'>',
      '# Partial heading',
      'partial body still arriving',
    ].join('\n');

    const segments = segmentMessageContent(content, { streaming: true });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      kind: 'document',
      block: {
        state: 'streaming',
        spec: { format: 'docx' },
        body: '# Partial heading\npartial body still arriving',
      },
    });
  });

  it('treats an incomplete opening tag as streaming with spec null while streaming', () => {
    const content = 'Some prose\n<cog-doc spec=\'{"format":"docx"';

    const segments = segmentMessageContent(content, { streaming: true });

    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ kind: 'markdown', text: 'Some prose\n' });
    expect(segments[1]).toMatchObject({
      kind: 'document',
      block: { state: 'streaming', spec: null, body: '' },
    });
  });

  it('fails open to plain markdown for an unterminated block once streaming has finished', () => {
    const content = [
      'Here you go:',
      '<cog-doc spec=\'{"format":"docx"}\'>',
      'body never closed',
    ].join('\n');

    const segments = segmentMessageContent(content, { streaming: false });

    expect(segments).toEqual<MessageSegment[]>([
      { kind: 'markdown', text: 'Here you go:\n' },
      {
        kind: 'markdown',
        text: '<cog-doc spec=\'{"format":"docx"}\'>\nbody never closed',
      },
    ]);
  });

  it('fails open to plain markdown for an incomplete opening tag once streaming has finished', () => {
    const content = 'Prose\n<cog-doc spec=\'{"format"';

    const segments = segmentMessageContent(content, { streaming: false });

    expect(segments).toEqual<MessageSegment[]>([
      { kind: 'markdown', text: 'Prose\n' },
      { kind: 'markdown', text: '<cog-doc spec=\'{"format"' },
    ]);
  });

  // PIN: known v1 quirk (spec §6.1) — the closing sentinel is matched as
  // plain text at line-start with no fenced-code awareness, so a literal
  // `</cog-doc>` inside a fenced block inside the body closes the block
  // early. Deliberate simplification; revisit only if real content collides.
  it('pins the v1 quirk that a </cog-doc> inside fenced code closes the block early', () => {
    const content = [
      '<cog-doc spec=\'{"format":"docx"}\'>',
      '```html',
      '</cog-doc>',
      '```',
      '</cog-doc>',
    ].join('\n');

    const segments = segmentMessageContent(content, { streaming: false });

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      kind: 'document',
      block: { state: 'ready', body: '```html' },
    });
    expect(segments[1]).toEqual({ kind: 'markdown', text: '\n```\n</cog-doc>' });
  });

  it('marks a block invalid when the raw source exceeds the size cap', () => {
    const filler = 'x'.repeat(COG_DOC_MAX_SOURCE_BYTES + 1);
    const content = ['<cog-doc spec=\'{"format":"docx"}\'>', filler, '</cog-doc>'].join(
      '\n',
    );

    const segments = segmentMessageContent(content, { streaming: false });

    expect(segments[0]).toMatchObject({
      kind: 'document',
      block: { state: 'invalid' },
    });
  });

  it('does not match a sentinel that is not at the start of a line', () => {
    const content = 'prose a<cog-doc spec=\'{"format":"docx"}\'>body</cog-doc>';

    const segments = segmentMessageContent(content, { streaming: false });

    expect(segments).toEqual<MessageSegment[]>([{ kind: 'markdown', text: content }]);
  });

  it('matches an opening tag indented up to 3 spaces but not 4+ (code block)', () => {
    const indented = [
      '   <cog-doc spec=\'{"format":"docx"}\'>',
      'body',
      '</cog-doc>',
    ].join('\n');
    const codeBlock = [
      '    <cog-doc spec=\'{"format":"docx"}\'>',
      'body',
      '</cog-doc>',
    ].join('\n');

    expect(segmentMessageContent(indented, { streaming: false })[0]).toMatchObject({
      kind: 'document',
    });
    expect(segmentMessageContent(codeBlock, { streaming: false })).toEqual<
      MessageSegment[]
    >([{ kind: 'markdown', text: codeBlock }]);
  });

  it('normalises CRLF line endings so the sentinels still match', () => {
    const content = [
      '<cog-doc spec=\'{"format":"docx"}\'>',
      'line one',
      'line two',
      '</cog-doc>',
    ].join('\r\n');

    const segments = segmentMessageContent(content, { streaming: false });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      kind: 'document',
      block: { state: 'ready', body: 'line one\nline two' },
    });
  });
});

describe('filenameBaseFromSpec', () => {
  it.each([
    [
      { format: 'docx', filename: 'quarterly', title: 'Quarterly Report' },
      '# Heading',
      'quarterly',
    ],
    [{ format: 'docx', title: 'Quarterly Report' }, '# Heading', 'Quarterly Report'],
    [{ format: 'docx' }, '# Executive summary\nBody', 'Executive summary'],
    [{ format: 'docx' }, 'No heading here', null],
    [null, '# Heading', 'Heading'],
    [null, 'No heading', null],
  ] as const)('resolves %j / %j -> %j', (spec, body, expected) => {
    expect(filenameBaseFromSpec(spec, body)).toBe(expected);
  });
});

describe('renderOptionsFromSpec', () => {
  it('returns an empty object for a null spec', () => {
    expect(renderOptionsFromSpec(null)).toEqual({});
  });

  it('maps title/lang/header/footer straight through', () => {
    expect(
      renderOptionsFromSpec({
        format: 'docx',
        title: 'Report',
        lang: 'en-GB',
        header: 'Header text',
        footer: { pageNumbers: true },
      }),
    ).toEqual({
      title: 'Report',
      lang: 'en-GB',
      header: 'Header text',
      footer: { pageNumbers: true },
    });
  });

  it('maps landscape orientation and defaults page size to A4', () => {
    expect(
      renderOptionsFromSpec({
        format: 'pdf',
        page: { orientation: 'landscape' },
      }),
    ).toEqual({ page: { size: 'A4', orientation: 'landscape' } });
  });

  it('defaults orientation to portrait when only size is given', () => {
    expect(
      renderOptionsFromSpec({
        format: 'pdf',
        page: { size: 'A4' },
      }),
    ).toEqual({ page: { size: 'A4', orientation: 'portrait' } });
  });
});
