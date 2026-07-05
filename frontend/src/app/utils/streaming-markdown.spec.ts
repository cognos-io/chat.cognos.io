import { describe, expect, it } from 'vitest';

import { splitStreamingMarkdown } from './streaming-markdown';

describe('splitStreamingMarkdown', () => {
  it('keeps everything in the tail when no block has completed yet', () => {
    // No blank line → the first paragraph is still in progress.
    expect(splitStreamingMarkdown('Now typing the first par')).toEqual({
      stable: '',
      tail: 'Now typing the first par',
    });
  });

  it('promotes a completed paragraph once a blank line follows it', () => {
    const content =
      '## Overview\n\nFirst paragraph is done.\n\nNow typing this second par';
    expect(splitStreamingMarkdown(content)).toEqual({
      stable: '## Overview\n\nFirst paragraph is done.\n\n',
      tail: 'Now typing this second par',
    });
  });

  it('never cuts inside an open code fence, even across a blank line', () => {
    // A blank line INSIDE the code block must not become a split point, or the
    // fence would render as a broken/incomplete code block.
    const content = 'Intro done.\n\n```py\ndef f():\n\n    return 1\n';
    expect(splitStreamingMarkdown(content)).toEqual({
      stable: 'Intro done.\n\n',
      tail: '```py\ndef f():\n\n    return 1\n',
    });
  });

  it('renders a completed code fence once its closing delimiter arrives', () => {
    const content = '```js\nconst x = 1;\n```\n\nAfter the code';
    expect(splitStreamingMarkdown(content)).toEqual({
      stable: '```js\nconst x = 1;\n```\n\n',
      tail: 'After the code',
    });
  });

  it('holds an open $$ math block in the tail', () => {
    const content = 'Before.\n\n$$\n a = b\n';
    expect(splitStreamingMarkdown(content)).toEqual({
      stable: 'Before.\n\n',
      tail: '$$\n a = b\n',
    });
  });

  it('promotes a completed $$ math block', () => {
    const content = '$$\n a = b\n$$\n\nnext';
    expect(splitStreamingMarkdown(content)).toEqual({
      stable: '$$\n a = b\n$$\n\n',
      tail: 'next',
    });
  });

  it('keeps a whole list in the tail until the list ends', () => {
    // Single newlines between items are not block boundaries — the list is one
    // block that stays in the tail until a blank line closes it.
    const content = '- first done\n- second done\n- third still typ';
    expect(splitStreamingMarkdown(content)).toEqual({
      stable: '',
      tail: '- first done\n- second done\n- third still typ',
    });
  });

  it('promotes a whole list once a blank line follows it', () => {
    const content = '- a\n- b\n- c\n\nNext paragraph starting';
    expect(splitStreamingMarkdown(content)).toEqual({
      stable: '- a\n- b\n- c\n\n',
      tail: 'Next paragraph starting',
    });
  });

  it('does not treat a fence line inside another fence as a closer', () => {
    // A ~~~ line inside a ```-opened fence is content, so the block stays open.
    const content = '```\n~~~ still inside\n\ncode continues';
    expect(splitStreamingMarkdown(content)).toEqual({
      stable: '',
      tail: '```\n~~~ still inside\n\ncode continues',
    });
  });

  it.each([
    { name: 'empty string', input: '' },
    { name: 'null', input: null },
    { name: 'undefined', input: undefined },
  ])('handles $name without throwing', ({ input }) => {
    expect(splitStreamingMarkdown(input)).toEqual({ stable: '', tail: '' });
  });
});
