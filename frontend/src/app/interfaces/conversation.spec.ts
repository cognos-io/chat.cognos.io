import { beforeAll, describe, expect, it, test } from 'vitest';

import {
  ConversationData,
  parseConversationData,
  serializeConversationData,
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
