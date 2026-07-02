import { describe, expect, it } from 'vitest';

import { sanitizeMarkdown } from './sanitize-markdown';

describe('sanitizeMarkdown', () => {
  it('keeps legitimate markdown output', () => {
    const cases = [
      '<p>Hello <strong>world</strong></p>',
      '<ul><li><input type="checkbox" disabled> task</li></ul>',
      '<table><thead><tr><th>a</th></tr></thead></table>',
      '<a href="https://example.com" rel="noopener">link</a>',
    ];
    for (const html of cases) {
      // Content survives; we only assert it is not emptied out.
      expect(sanitizeMarkdown(html)).not.toBe('');
    }
  });

  it.each([
    [
      'inline style attribute (UI-redress overlay)',
      '<div style="position:fixed;inset:0">x</div>',
      'style=',
    ],
    [
      'form element (credential phishing)',
      '<form action="https://evil.example"><input name="key"></form>',
      '<form',
    ],
    ['bare input control', '<input type="password" name="accountKey">', '<input'],
    ['button element', '<button onclick="steal()">go</button>', '<button'],
    ['event handler attribute', '<img src=x onerror="alert(1)">', 'onerror'],
    ['javascript: URL', '<a href="javascript:alert(1)">x</a>', 'javascript:'],
    ['script tag', '<script>alert(1)</script>', '<script'],
    ['iframe', '<iframe src="https://evil.example"></iframe>', '<iframe'],
    ['svg onload', '<svg onload="alert(1)"></svg>', 'onload'],
  ])('strips %s', (_label, input, forbidden) => {
    const output = sanitizeMarkdown(input);
    expect(output.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });
});
