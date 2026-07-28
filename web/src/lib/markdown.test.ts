import assert from 'node:assert/strict';
import { test } from 'node:test';

import { blocksToMarkdown, inlineToMarkdown, mdDocument } from './markdown.ts';

// The serializer turns the catalogue's declarative blocks into plain markdown
// for `/*.md` and `llms.txt`. Two properties matter throughout: no HTML tag
// ever survives into the output, and every internal link becomes absolute
// (an LLM fetching a bare .md file has no base URL to resolve against).

test('inline: bold, code and links become markdown', () => {
  assert.equal(inlineToMarkdown('plain text'), 'plain text');
  assert.equal(inlineToMarkdown('a <b>bold</b> word'), 'a **bold** word');
  assert.equal(inlineToMarkdown('a <strong>bold</strong> word'), 'a **bold** word');
  assert.equal(inlineToMarkdown('an <i>italic</i> word'), 'an *italic* word');
  assert.equal(inlineToMarkdown('an <em>italic</em> word'), 'an *italic* word');
  assert.equal(inlineToMarkdown('the <code>--flag</code>'), 'the `--flag`');
});

test('inline: internal links absolutise, external links pass through', () => {
  assert.equal(
    inlineToMarkdown('see <a href="/docs/account-key">the key</a>'),
    'see [the key](https://cognos.io/docs/account-key)',
  );
  assert.equal(
    inlineToMarkdown('see <a href="https://example.com/x">x</a>'),
    'see [x](https://example.com/x)',
  );
  assert.equal(
    inlineToMarkdown('write to <a href="mailto:hi@cognos.io">us</a>'),
    'write to [us](mailto:hi@cognos.io)',
  );
});

test('inline: internal links absolutise into the active locale', () => {
  assert.equal(
    inlineToMarkdown('siehe <a href="/docs/account-key">der Schlüssel</a>', 'de'),
    'siehe [der Schlüssel](https://cognos.io/de/docs/account-key)',
  );
  // An in-page anchor has no page to resolve to, so it is dropped to its text
  // rather than pointing a reader at a fragment of a file they already hold.
  assert.equal(
    inlineToMarkdown('jump <a href="#section-2">down</a>', 'de'),
    'jump down',
  );
});

test('inline: unknown tags are stripped and entities decoded', () => {
  assert.equal(
    inlineToMarkdown('a <span class="x">tagged</span> word'),
    'a tagged word',
  );
  assert.equal(inlineToMarkdown('Cognos &amp; you'), 'Cognos & you');
  assert.equal(inlineToMarkdown('&lt;not a tag&gt;'), '<not a tag>');
  assert.equal(inlineToMarkdown('it&rsquo;s &quot;quoted&quot;'), 'it’s "quoted"');
  assert.equal(inlineToMarkdown('a&nbsp;space'), 'a space');
});

test('inline: the entities and tags the catalogues actually use', () => {
  // Pin: `<a>`, `<b>`, `<code>` and `<br>` are the only tags authored in the
  // six locale files, and `&lsaquo;`/`&rsaquo;`/`&amp;` the only entities.
  assert.equal(inlineToMarkdown('Settings &rsaquo; Account'), 'Settings › Account');
  assert.equal(inlineToMarkdown('&lsaquo; Back'), '‹ Back');
  assert.equal(inlineToMarkdown('one<br>two'), 'one\ntwo');
  assert.equal(inlineToMarkdown('one<br />two'), 'one\ntwo');
});

test('inline: markdown control characters in prose are escaped', () => {
  // Prose is authored for HTML, so a literal asterisk or underscore is not
  // meant as emphasis once the same string is read as markdown.
  assert.equal(inlineToMarkdown('5 * 3 = 15'), '5 \\* 3 = 15');
  assert.equal(inlineToMarkdown('snake_case_name'), 'snake\\_case\\_name');
  assert.equal(inlineToMarkdown('a [bracket]'), 'a \\[bracket\\]');
});

test('blocks: paragraphs, headings and lists', () => {
  assert.equal(
    blocksToMarkdown([{ p: 'First.' }, { p: 'Second.' }]),
    'First.\n\nSecond.',
  );
  assert.equal(blocksToMarkdown([{ h3: 'A heading' }]), '### A heading');
  assert.equal(blocksToMarkdown([{ ul: ['one', 'two'] }]), '- one\n- two');
});

test('blocks: steps become a numbered list', () => {
  assert.equal(
    blocksToMarkdown([
      { steps: [{ title: 'Open it', body: 'Tap the icon.' }, { title: 'Done' }] },
    ]),
    '1. **Open it**\n   Tap the icon.\n2. **Done**',
  );
});

test('blocks: notes become a labelled blockquote', () => {
  assert.equal(
    blocksToMarkdown([
      { note: { variant: 'security', title: 'Careful', body: 'Keep it.' } },
    ]),
    '> **Security: Careful**\n>\n> Keep it.',
  );
  // No title and no variant: still labelled, so the aside reads as an aside.
  assert.equal(
    blocksToMarkdown([{ note: { body: 'A hint.' } }]),
    '> **Tip**\n>\n> A hint.',
  );
});

test('blocks: tables become GitHub-flavoured markdown', () => {
  assert.equal(
    blocksToMarkdown([
      {
        table: {
          head: ['Who', 'Where'],
          rows: [
            ['Bunny', 'EU'],
            ['Hetzner', 'CH'],
          ],
        },
      },
    ]),
    '| Who | Where |\n| --- | --- |\n| Bunny | EU |\n| Hetzner | CH |',
  );
});

test('blocks: a pipe inside a table cell is escaped, not a new column', () => {
  assert.equal(
    blocksToMarkdown([{ table: { head: ['Key'], rows: [['a|b']] } }]),
    '| Key |\n| --- |\n| a\\|b |',
  );
});

test('blocks: cards become a link list with absolute targets', () => {
  assert.equal(
    blocksToMarkdown([
      { cards: [{ to: '/docs/branches', title: 'Branches', body: 'Fork a chat.' }] },
    ]),
    '- [Branches](https://cognos.io/docs/branches): Fork a chat.',
  );
});

test('blocks: figures and galleries keep alt text, drop the image', () => {
  // Screenshots of the app carry no information an LLM can use, and the
  // resolved paths differ per locale. The alt text is the content.
  assert.equal(
    blocksToMarkdown([
      { figure: { src: '/docs-media/x.png', alt: 'The unlock screen' } },
    ]),
    '(Screenshot: The unlock screen)',
  );
  assert.equal(
    blocksToMarkdown([
      {
        gallery: {
          label: 'Tour',
          images: [
            { src: '/a.png', alt: 'First shot' },
            { src: '/b.png', alt: 'Second shot' },
          ],
        },
      },
    ]),
    '(Screenshot: First shot)\n\n(Screenshot: Second shot)',
  );
});

test('blocks: an unknown block shape is skipped, not crashed on', () => {
  // Pin: the catalogue is data, and a block type added to the renderer before
  // the serializer must degrade to omission rather than break the build.
  assert.equal(
    blocksToMarkdown([
      { p: 'kept' },
      { video: { src: '/x.mp4' } } as never,
      { p: 'also kept' },
    ]),
    'kept\n\nalso kept',
  );
});

test('document: front matter, heading and canonical source URL', () => {
  const out = mdDocument({
    title: 'Terms of Service',
    description: 'The terms you agree to.',
    url: 'https://cognos.io/terms',
    updated: '2026-07-01',
    body: 'Some body text.',
  });
  assert.match(out, /^# Terms of Service\n/);
  assert.match(out, /^> The terms you agree to\.$/m);
  assert.match(out, /^Source: https:\/\/cognos\.io\/terms$/m);
  assert.match(out, /^Last updated: 2026-07-01$/m);
  assert.match(out, /Some body text\.\n$/);
  assert.ok(!out.includes('<'), 'a rendered document contains no HTML');
  assert.ok(out.endsWith('\n'), 'files end with a newline');
});

test('document: optional fields are omitted rather than left blank', () => {
  const out = mdDocument({
    title: 'Contact',
    url: 'https://cognos.io/contact',
    body: 'Hi.',
  });
  assert.equal(out, '# Contact\n\nSource: https://cognos.io/contact\n\nHi.\n');
});
