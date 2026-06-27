import { beforeAll, describe, expect, it } from 'vitest';

import { MessageData, isMessageFromUser, parseMessageData } from './message';

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

describe('parseMessageData', () => {
  beforeAll(() => {
    globalThis.TextEncoder = TestTextEncoder as typeof TextEncoder;
    globalThis.TextDecoder = TestTextDecoder as typeof TextDecoder;
  });

  it('parses a minimal user message', () => {
    const payload = encode(JSON.stringify({ content: 'hello', owner_id: 'user-1' }));
    const parsed = parseMessageData(payload);

    expect(parsed.content).toBe('hello');
    expect(parsed.owner_id).toBe('user-1');
  });

  it('parses an assistant message with model + persona metadata', () => {
    const payload = encode(
      JSON.stringify({
        content: 'reply',
        persona_id: 'persona-1',
        model_id: 'model-1',
      }),
    );
    const parsed = parseMessageData(payload);

    expect(parsed.content).toBe('reply');
    expect(parsed.persona_id).toBe('persona-1');
    expect(parsed.model_id).toBe('model-1');
    expect(parsed.owner_id).toBeUndefined();
  });

  it('allows nullable content for placeholder records', () => {
    const payload = encode(JSON.stringify({ content: null }));
    const parsed = parseMessageData(payload);

    expect(parsed.content).toBeNull();
  });

  it('rejects payloads missing the required content field', () => {
    const payload = encode(JSON.stringify({ owner_id: 'user-1' }));
    expect(() => parseMessageData(payload)).toThrow();
  });

  it('parses the encrypted created_at timestamp', () => {
    const payload = encode(
      JSON.stringify({ content: 'reply', created_at: '2026-06-09T22:36:04Z' }),
    );
    const parsed = parseMessageData(payload);

    expect(parsed.created_at).toBe('2026-06-09T22:36:04Z');
  });

  it('treats a message without created_at as valid (legacy records)', () => {
    const payload = encode(JSON.stringify({ content: 'legacy message' }));
    const parsed = parseMessageData(payload);

    expect(parsed.created_at).toBeUndefined();
  });

  it('rejects payloads with an unknown version', () => {
    const payload = encode(JSON.stringify({ content: 'x', version: '99' }));
    expect(() => parseMessageData(payload)).toThrow();
  });

  it('rejects payloads that are not valid JSON', () => {
    const payload = encode('not json');
    expect(() => parseMessageData(payload)).toThrow();
  });

  it('rejects payloads with a non-string content field', () => {
    const payload = encode(JSON.stringify({ content: 42 }));
    expect(() => parseMessageData(payload)).toThrow();
  });

  it('parses a user-upload attachment that has no sealed_key', () => {
    // User uploads keep their key in the encrypted attachment manifest, so the
    // backend omits sealed_key (omitempty). The message must still decrypt.
    const payload = encode(
      JSON.stringify({
        content: 'see attached',
        attachments: [
          {
            kind: 'user_upload',
            mime_type: 'text/markdown',
            attachment_id: 'att-1',
          },
        ],
      }),
    );
    const parsed = parseMessageData(payload);

    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments?.[0].attachment_id).toBe('att-1');
    expect(parsed.attachments?.[0].sealed_key).toBeUndefined();
  });

  it('parses a generated-image attachment that has a sealed_key', () => {
    const payload = encode(
      JSON.stringify({
        content: null,
        attachments: [
          {
            kind: 'generated_image',
            mime_type: 'image/png',
            sealed_key: 'c2VhbGVk',
            width: 512,
            height: 512,
          },
        ],
      }),
    );
    const parsed = parseMessageData(payload);

    expect(parsed.attachments?.[0].sealed_key).toBe('c2VhbGVk');
    expect(parsed.attachments?.[0].attachment_id).toBeUndefined();
  });
});

describe('isMessageFromUser', () => {
  const base: MessageData = { content: 'hi' };

  it('returns true when owner_id is a non-empty string', () => {
    expect(isMessageFromUser({ ...base, owner_id: 'user-1' })).toBe(true);
  });

  it('returns false when owner_id is missing', () => {
    expect(isMessageFromUser(base)).toBe(false);
  });

  it('returns false when owner_id is the empty string', () => {
    expect(isMessageFromUser({ ...base, owner_id: '' })).toBe(false);
  });

  it('returns false when owner_id is whitespace only', () => {
    expect(isMessageFromUser({ ...base, owner_id: '   ' })).toBe(false);
  });
});
