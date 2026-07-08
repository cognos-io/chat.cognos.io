import { describe, expect, it } from 'vitest';

import { type Message, type MessageData } from '@app/interfaces/message';

import {
  MINIMAP_MAX_TICKS,
  deriveMinimapTicks,
  pickActiveTickId,
  truncatePreview,
} from './minimap';

function msg(partial: {
  id?: string;
  owner?: boolean;
  content?: string | null;
  deleted?: boolean;
}): Message {
  const data: MessageData = {
    // Distinguish an explicit null (attachment-only turn) from an absent key.
    content: 'content' in partial ? partial.content : 'hello',
    owner_id: partial.owner ? 'user-1' : undefined,
    deleted: partial.deleted,
  } as MessageData;
  return {
    record_id: partial.id,
    decryptedData: data,
    createdAt: new Date(0),
  };
}

describe('truncatePreview', () => {
  it('collapses whitespace and trims', () => {
    expect(truncatePreview('  a\n\n b   c ')).toBe('a b c');
  });

  it('truncates with an ellipsis past the limit', () => {
    expect(truncatePreview('abcdef', 3)).toBe('abc…');
  });

  it('does not truncate short content', () => {
    expect(truncatePreview('abc', 3)).toBe('abc');
  });

  it('is code-point safe with emoji', () => {
    expect(truncatePreview('😀😀😀😀', 2)).toBe('😀😀…');
  });
});

describe('deriveMinimapTicks', () => {
  it('keeps only user turns with a record id', () => {
    const messages = [
      msg({ id: 'u1', owner: true, content: 'first question' }),
      msg({ id: 'a1', owner: false, content: 'assistant reply' }),
      msg({ id: 'u2', owner: true, content: 'second question' }),
    ];
    const ticks = deriveMinimapTicks(messages);
    expect(ticks.map((t) => t.id)).toEqual(['u1', 'u2']);
    expect(ticks[0].preview).toBe('first question');
  });

  it('skips messages without a record id (temp chat / streaming)', () => {
    const ticks = deriveMinimapTicks([msg({ owner: true, content: 'no id' })]);
    expect(ticks).toEqual([]);
  });

  it('skips deleted (tombstoned) user turns', () => {
    const ticks = deriveMinimapTicks([
      msg({ id: 'u1', owner: true, content: '', deleted: true }),
    ]);
    expect(ticks).toEqual([]);
  });

  it('keeps only the most recent maxTicks', () => {
    const messages = Array.from({ length: MINIMAP_MAX_TICKS + 5 }, (_, i) =>
      msg({ id: `u${i}`, owner: true, content: `q${i}` }),
    );
    const ticks = deriveMinimapTicks(messages);
    expect(ticks).toHaveLength(MINIMAP_MAX_TICKS);
    expect(ticks[0].id).toBe('u5');
    expect(ticks.at(-1)?.id).toBe(`u${MINIMAP_MAX_TICKS + 4}`);
  });

  it('handles null content on an attachment-only turn', () => {
    const ticks = deriveMinimapTicks([msg({ id: 'u1', owner: true, content: null })]);
    expect(ticks).toEqual([{ id: 'u1', preview: '' }]);
  });
});

describe('pickActiveTickId', () => {
  const ids = ['u1', 'u2', 'u3'];

  it('returns the last visible id', () => {
    expect(pickActiveTickId(ids, new Set(['u1', 'u2']))).toBe('u2');
  });

  it('returns null when nothing is visible', () => {
    expect(pickActiveTickId(ids, new Set())).toBeNull();
  });

  it('ignores visible ids not in the ordered list', () => {
    expect(pickActiveTickId(ids, new Set(['ghost']))).toBeNull();
  });
});
