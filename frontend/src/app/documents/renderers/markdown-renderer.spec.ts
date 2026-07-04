import { describe, expect, it } from 'vitest';

import { renderMarkdownFile } from './markdown-renderer';

describe('renderMarkdownFile', () => {
  it('encodes the markdown source as UTF-8 bytes unchanged', () => {
    const bytes = renderMarkdownFile('# Title\n\nHello **world**.');
    expect(new TextDecoder().decode(bytes)).toBe('# Title\n\nHello **world**.');
  });

  it('round-trips non-ASCII content', () => {
    const bytes = renderMarkdownFile('Café ☕ — 日本語');
    expect(new TextDecoder().decode(bytes)).toBe('Café ☕ — 日本語');
  });

  it('encodes an empty string as zero bytes', () => {
    expect(renderMarkdownFile('').length).toBe(0);
  });
});
