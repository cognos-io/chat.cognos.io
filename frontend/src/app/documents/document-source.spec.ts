import { describe, expect, it } from 'vitest';

import {
  documentFilename,
  documentMimeType,
  sanitizeDocumentHref,
} from './document-source';

describe('sanitizeDocumentHref', () => {
  it.each([
    ['https://example.com/a', 'https://example.com/a'],
    ['http://example.com', 'http://example.com/'],
    ['https://example.com/a?x=1', 'https://example.com/a?x=1'],
    ['https://example.com/a#frag', 'https://example.com/a#frag'],
    ['  https://example.com/a  ', 'https://example.com/a'],
  ])('accepts http(s) URL %s', (input, expected) => {
    expect(sanitizeDocumentHref(input)).toBe(expected);
  });

  it.each([
    ['javascript:alert(1)'],
    ['data:text/plain;base64,aGk='],
    ['mailto:x@example.com'],
    ['ftp://example.com'],
    ['./relative'],
    ['//evil.example.com'],
    [''],
    ['   '],
    ['not a url'],
    [null],
    [undefined],
  ])('rejects non-http(s), relative or malformed href %s', (input) => {
    expect(sanitizeDocumentHref(input as string | null | undefined)).toBeNull();
  });
});

describe('documentFilename', () => {
  it.each([
    ['Quarterly Report', 'docx', 'fallback', 'Quarterly Report.docx'],
    ['a/b\\c', 'pdf', 'fallback', 'a-b-c.pdf'],
    ['a<b>c:d"e|f?g*h', 'markdown', 'fallback', 'a-b-c-d-e-f-g-h.md'],
    ['bad\x00\x1fname', 'docx', 'fallback', 'bad-name.docx'],
    ['too   many   spaces', 'docx', 'fallback', 'too many spaces.docx'],
    ['many---hyphens', 'docx', 'fallback', 'many-hyphens.docx'],
    ['  .trim.me.  ', 'docx', 'fallback', 'trim.me.docx'],
    ['CON', 'docx', 'fallback', '_CON.docx'],
    ['con', 'docx', 'fallback', '_con.docx'],
    ['COM1', 'pdf', 'fallback', '_COM1.pdf'],
    ['LPT9', 'markdown', 'fallback', '_LPT9.md'],
    ['Notes', 'markdown', 'fallback', 'Notes.md'],
    ['Résumé', 'docx', 'fallback', 'Résumé.docx'],
    ['***', 'docx', 'fallback', 'fallback.docx'],
    ['', 'docx', 'fallback', 'fallback.docx'],
    [null, 'docx', 'fallback', 'fallback.docx'],
    [undefined, 'pdf', 'fallback', 'fallback.pdf'],
    ['   ', 'markdown', 'fallback', 'fallback.md'],
  ])('sanitises %s (%s) -> %s', (base, format, fallback, expected) => {
    expect(
      documentFilename(base as string | null | undefined, format as never, fallback),
    ).toBe(expected);
  });

  it('caps the base name at 80 characters before appending the extension', () => {
    const base = 'a'.repeat(90);
    const filename = documentFilename(base, 'docx', 'fallback');
    expect(filename).toBe(`${'a'.repeat(80)}.docx`);
  });

  it('re-trims trailing dots/spaces produced by the 80-char cap', () => {
    const base = `${'a'.repeat(79)}. more text after the cut`;
    const filename = documentFilename(base, 'docx', 'fallback');
    expect(filename.startsWith('.docx')).toBe(false);
    expect(filename.endsWith('.docx')).toBe(true);
    expect(filename).not.toMatch(/[.\s]\.docx$/);
  });

  it.each([
    ['docx', '.docx'],
    ['pdf', '.pdf'],
    ['markdown', '.md'],
  ])('appends the correct extension for format %s', (format, extension) => {
    expect(documentFilename('name', format as never, 'fallback')).toBe(
      `name${extension}`,
    );
  });
});

describe('documentMimeType', () => {
  it.each([
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['pdf', 'application/pdf'],
    ['markdown', 'text/markdown'],
  ])('maps format %s to %s', (format, mime) => {
    expect(documentMimeType(format as never)).toBe(mime);
  });
});
