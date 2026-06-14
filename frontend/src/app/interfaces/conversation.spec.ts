import { beforeAll, describe, expect, it, test } from 'vitest';

import {
  Conversation,
  ConversationData,
  parseConversationData,
  partitionConversationsByPinned,
  serializeConversationData,
  sortConversationsByUpdated,
} from './conversation';

class TestTextEncoder {
  encode(input: string): Uint8Array {
    return Uint8Array.from(input, (character) => character.charCodeAt(0));
  }
}

class TestTextDecoder {
  decode(input: Uint8Array): string {
    return String.fromCharCode(...input);
  }
}

const encode = (value: string): Uint8Array => new TestTextEncoder().encode(value);
const decode = (bytes: Uint8Array): string => new TestTextDecoder().decode(bytes);

describe('conversation data parse and serialize', () => {
  beforeAll(() => {
    globalThis.TextEncoder = TestTextEncoder as typeof TextEncoder;
    globalThis.TextDecoder = TestTextDecoder as typeof TextDecoder;
  });

  interface validTestCase {
    name: string;
    data: ConversationData;
    serializedData: Uint8Array;
  }
  const validTable: Array<validTestCase> = [
    {
      name: 'valid',
      data: {
        title: 'foo bar',
      },
      serializedData: new Uint8Array([
        123, 34, 116, 105, 116, 108, 101, 34, 58, 34, 102, 111, 111, 32, 98, 97, 114,
        34, 125,
      ]),
    },
  ];

  test.each(validTable)('parseConversationData $name', ({ data, serializedData }) => {
    const serialized = serializeConversationData(data);
    const parsed = parseConversationData(serialized);

    expect(Array.from(serialized)).toEqual(Array.from(serializedData));
    expect(parsed).toEqual(data);
  });

  it('trims surrounding whitespace from the title', () => {
    const payload = encode(JSON.stringify({ title: '  padded title  ' }));
    expect(parseConversationData(payload).title).toBe('padded title');
  });

  it('rejects payloads missing the title field', () => {
    const payload = encode(JSON.stringify({}));
    expect(() => parseConversationData(payload)).toThrow();
  });

  it('rejects payloads where title is not a string', () => {
    const payload = encode(JSON.stringify({ title: 42 }));
    expect(() => parseConversationData(payload)).toThrow();
  });

  it('rejects payloads that are not valid JSON', () => {
    const payload = encode('not json');
    expect(() => parseConversationData(payload)).toThrow();
  });

  it('strips unknown fields rather than persisting them in ciphertext', () => {
    // The decrypted payload must not silently carry attacker-injected or stale
    // fields. zod's strict-shape parse drops anything outside the schema.
    const withExtras = {
      title: 'extras dropped',
      secret: 'should not be persisted',
    } as unknown as ConversationData;

    const serialized = serializeConversationData(withExtras);
    const payload = JSON.parse(decode(serialized)) as Record<string, unknown>;

    expect(payload['title']).toBe('extras dropped');
    expect(payload['secret']).toBeUndefined();
  });
});

describe('conversation sidebar ordering', () => {
  const makeConversation = (id: string, updated: string): Conversation => ({
    record: {
      id,
      created: '2026-01-01T00:00:00.000Z',
      updated,
      data: '',
    },
    decryptedData: { title: id },
    keyPair: {
      publicKey: new Uint8Array(),
      secretKey: new Uint8Array(),
    },
  });

  it('sorts conversations by most recently updated first', () => {
    const conversations = [
      makeConversation('old', '2026-01-01T00:00:00.000Z'),
      makeConversation('newest', '2026-01-03T00:00:00.000Z'),
      makeConversation('middle', '2026-01-02T00:00:00.000Z'),
    ];

    expect(sortConversationsByUpdated(conversations).map((c) => c.record.id)).toEqual([
      'newest',
      'middle',
      'old',
    ]);
  });

  it('orders by instant across mixed timestamp formats', () => {
    // Backend serialises with a space; an optimistic client bump uses ISO "T".
    // A naive string compare would sort the "T" form first regardless of time.
    const conversations = [
      makeConversation('backend-later', '2026-01-01 16:30:00.000Z'),
      makeConversation('client-earlier', '2026-01-01T09:00:00.000Z'),
    ];

    expect(sortConversationsByUpdated(conversations).map((c) => c.record.id)).toEqual([
      'backend-later',
      'client-earlier',
    ]);
  });

  it('partitions pinned conversations in pin order and recent by updated time', () => {
    const conversations = [
      makeConversation('recent-old', '2026-01-01T00:00:00.000Z'),
      makeConversation('pinned-b', '2026-01-02T00:00:00.000Z'),
      makeConversation('recent-new', '2026-01-04T00:00:00.000Z'),
      makeConversation('pinned-a', '2026-01-03T00:00:00.000Z'),
    ];

    const { pinned, recent } = partitionConversationsByPinned(conversations, [
      'pinned-a',
      'pinned-b',
    ]);

    expect(pinned.map((conversation) => conversation.record.id)).toEqual([
      'pinned-a',
      'pinned-b',
    ]);
    expect(recent.map((conversation) => conversation.record.id)).toEqual([
      'recent-new',
      'recent-old',
    ]);
  });

  it('returns an empty pinned list when nothing is pinned', () => {
    const conversations = [makeConversation('recent', '2026-01-01T00:00:00.000Z')];

    const { pinned, recent } = partitionConversationsByPinned(conversations, []);

    expect(pinned).toEqual([]);
    expect(recent.map((conversation) => conversation.record.id)).toEqual(['recent']);
  });
});
