import { describe, expect, it } from 'vitest';

import { DocBlock, DocInline } from '../document.types';
import { markdownToDocIR } from './markdown-to-docir';

const text = (value: string): DocInline => ({ type: 'text', text: value });

describe('markdownToDocIR', () => {
  it('maps an empty string to an empty document', () => {
    expect(markdownToDocIR('')).toEqual({ blocks: [] });
  });

  it.each([1, 2, 3, 4, 5, 6] as const)('maps a depth-%s heading', (depth) => {
    const markdown = `${'#'.repeat(depth)} Heading ${depth}`;
    expect(markdownToDocIR(markdown).blocks).toEqual([
      { type: 'heading', level: depth, inlines: [text(`Heading ${depth}`)] },
    ]);
  });

  it('maps a paragraph with mixed strong/em/codespan/del/link inlines', () => {
    const markdown =
      '**bold** and *em* and `code` and ~~del~~ and [link](https://example.com)';
    const [block] = markdownToDocIR(markdown).blocks;
    expect(block).toEqual<DocBlock>({
      type: 'paragraph',
      inlines: [
        { type: 'strong', inlines: [text('bold')] },
        text(' and '),
        { type: 'em', inlines: [text('em')] },
        text(' and '),
        { type: 'code', text: 'code' },
        text(' and '),
        { type: 'del', inlines: [text('del')] },
        text(' and '),
        { type: 'link', href: 'https://example.com/', inlines: [text('link')] },
      ],
    });
  });

  it('maps nested unordered lists three levels deep', () => {
    const markdown = '- a\n  - b\n    - c\n';
    expect(markdownToDocIR(markdown).blocks).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [
          {
            blocks: [
              { type: 'paragraph', inlines: [text('a')] },
              {
                type: 'list',
                ordered: false,
                items: [
                  {
                    blocks: [
                      { type: 'paragraph', inlines: [text('b')] },
                      {
                        type: 'list',
                        ordered: false,
                        items: [
                          { blocks: [{ type: 'paragraph', inlines: [text('c')] }] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('maps a nested ordered list', () => {
    const markdown = '1. first\n2. second\n   1. nested\n';
    const [list] = markdownToDocIR(markdown).blocks;
    if (list.type !== 'list') throw new Error('expected a list block');
    expect(list.ordered).toBe(true);
    expect(list.items).toHaveLength(2);
  });

  it('maps task list items with checked/unchecked state', () => {
    const markdown = '- [x] done\n- [ ] todo\n';
    expect(markdownToDocIR(markdown).blocks).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [
          {
            blocks: [{ type: 'paragraph', inlines: [text('done')] }],
            task: true,
            checked: true,
          },
          {
            blocks: [{ type: 'paragraph', inlines: [text('todo')] }],
            task: true,
            checked: false,
          },
        ],
      },
    ]);
  });

  it('maps a table with alignment including null', () => {
    const markdown = '| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n';
    expect(markdownToDocIR(markdown).blocks).toEqual([
      {
        type: 'table',
        header: [
          { inlines: [text('a')] },
          { inlines: [text('b')] },
          { inlines: [text('c')] },
        ],
        rows: [
          [
            { inlines: [text('1')] },
            { inlines: [text('2')] },
            { inlines: [text('3')] },
          ],
        ],
        align: ['left', 'center', 'right'],
      },
    ]);
  });

  it('maps a table without alignment hints to null aligns', () => {
    const markdown = '| a | b |\n|---|---|\n| 1 | 2 |\n';
    const [table] = markdownToDocIR(markdown).blocks;
    if (table.type !== 'table') throw new Error('expected a table block');
    expect(table.align).toEqual([null, null]);
  });

  it('maps a blockquote containing a list', () => {
    const markdown = '> - item1\n> - item2\n';
    expect(markdownToDocIR(markdown).blocks).toEqual([
      {
        type: 'blockquote',
        blocks: [
          {
            type: 'list',
            ordered: false,
            items: [
              { blocks: [{ type: 'paragraph', inlines: [text('item1')] }] },
              { blocks: [{ type: 'paragraph', inlines: [text('item2')] }] },
            ],
          },
        ],
      },
    ]);
  });

  it('maps a fenced code block with a language', () => {
    const markdown = '```js\nconst x = 1;\n```';
    expect(markdownToDocIR(markdown).blocks).toEqual([
      { type: 'code', text: 'const x = 1;', lang: 'js' },
    ]);
  });

  it('maps a fenced code block without a language', () => {
    const markdown = '```\nplain code\n```';
    expect(markdownToDocIR(markdown).blocks).toEqual([
      { type: 'code', text: 'plain code' },
    ]);
  });

  it('maps a horizontal rule', () => {
    expect(markdownToDocIR('---\n').blocks).toEqual([{ type: 'hr' }]);
  });

  it('strips an HTML block down to its text content', () => {
    expect(markdownToDocIR('<div>hi</div>').blocks).toEqual([
      { type: 'paragraph', inlines: [text('hi')] },
    ]);
  });

  it('reduces a script HTML block to its text content only', () => {
    expect(markdownToDocIR('<script>x</script>').blocks).toEqual([
      { type: 'paragraph', inlines: [text('x')] },
    ]);
  });

  it('degrades inline HTML tags, keeping the surrounding text', () => {
    const markdown = 'text <b>bold?</b> more';
    expect(markdownToDocIR(markdown).blocks).toEqual([
      { type: 'paragraph', inlines: [text('text '), text('bold?'), text(' more')] },
    ]);
  });

  it('decodes HTML entities in text and codespans', () => {
    const markdown = 'AT&amp;T said &#39;hi&#39; to &lt;you&gt; &amp; &quot;me&quot;';
    expect(markdownToDocIR(markdown).blocks).toEqual([
      { type: 'paragraph', inlines: [text(`AT&T said 'hi' to <you> & "me"`)] },
    ]);
  });

  it('drops a javascript: link, keeping only its text children', () => {
    const markdown = '[click](javascript:alert(1))';
    expect(markdownToDocIR(markdown).blocks).toEqual([
      { type: 'paragraph', inlines: [text('click')] },
    ]);
  });

  it('keeps a valid https: link', () => {
    const markdown = '[click](https://example.com)';
    expect(markdownToDocIR(markdown).blocks).toEqual([
      {
        type: 'paragraph',
        inlines: [
          { type: 'link', href: 'https://example.com/', inlines: [text('click')] },
        ],
      },
    ]);
  });

  it('degrades an inline markdown image to its alt text', () => {
    const markdown = '![alt](https://x/y.png)';
    expect(markdownToDocIR(markdown).blocks).toEqual([
      { type: 'paragraph', inlines: [text('alt')] },
    ]);
  });

  it('drops an inline image with empty alt text', () => {
    const markdown = '![](https://x/y.png)';
    expect(markdownToDocIR(markdown).blocks).toEqual([
      { type: 'paragraph', inlines: [] },
    ]);
  });

  it('leaves footnote syntax as literal text (no marked-footnote extension registered)', () => {
    const markdown = 'See [^1] for more.';
    expect(markdownToDocIR(markdown).blocks).toEqual([
      { type: 'paragraph', inlines: [text('See [^1] for more.')] },
    ]);
  });

  it('keeps a GitHub-alert blockquote as a plain blockquote with literal text', () => {
    const markdown = '> [!NOTE]\n> hi there';
    expect(markdownToDocIR(markdown).blocks).toEqual([
      {
        type: 'blockquote',
        blocks: [{ type: 'paragraph', inlines: [text('[!NOTE]\nhi there')] }],
      },
    ]);
  });

  it('leaves KaTeX syntax as literal text (no katex extension registered)', () => {
    expect(markdownToDocIR('$x^2$').blocks).toEqual([
      { type: 'paragraph', inlines: [text('$x^2$')] },
    ]);
  });

  it.each([
    ['unterminated fenced code block', '```js\nconst x = 1;'],
    ['unterminated link bracket', '[click('],
    ['unterminated emphasis markers', '***a**b*c_d'],
    ['deeply nested brackets', '[[[[[[[[[['.repeat(50)],
    ['lone HTML close tag', '</div>'],
    ['lone unicode surrogate', 'hello' + String.fromCharCode(0xd800) + 'world'],
  ])('never throws on pathological input: %s', (_label, markdown) => {
    expect(() => markdownToDocIR(markdown)).not.toThrow();
  });
});
