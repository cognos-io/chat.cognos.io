import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  UserPreferencesData,
  parseUserPreferencesData,
  serializeUserPreferencesData,
} from './user_preferences';

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

// These fakes are installed on the global scope, so they must be torn down after
// the suite — vitest can run other spec files in the same worker, and a leaked
// fake TextDecoder (which ignores the `fatal` flag) makes invalid-UTF-8 decodes
// silently succeed elsewhere (e.g. text.processor.spec). Save and restore the
// real globals to keep the pollution scoped to this file.
const realTextEncoder = globalThis.TextEncoder;
const realTextDecoder = globalThis.TextDecoder;

const installFakeTextCodecs = (): void => {
  globalThis.TextEncoder = TestTextEncoder as typeof TextEncoder;
  globalThis.TextDecoder = TestTextDecoder as typeof TextDecoder;
};

const restoreTextCodecs = (): void => {
  globalThis.TextEncoder = realTextEncoder;
  globalThis.TextDecoder = realTextDecoder;
};

describe('parseUserPreferencesData', () => {
  beforeAll(installFakeTextCodecs);
  afterAll(restoreTextCodecs);

  it('parses a fully populated payload', () => {
    const payload = encode(
      JSON.stringify({
        pinnedConversations: ['conv-a', 'conv-b'],
        pinnedModels: ['model-a'],
      }),
    );
    const parsed = parseUserPreferencesData(payload);

    expect(parsed.pinnedConversations).toEqual(['conv-a', 'conv-b']);
    expect(parsed.pinnedModels).toEqual(['model-a']);
  });

  it('defaults pinnedModels to an empty array when omitted', () => {
    const payload = encode(JSON.stringify({ pinnedConversations: ['c-1'] }));

    expect(parseUserPreferencesData(payload).pinnedModels).toEqual([]);
  });

  it('defaults recentModels and hiddenModels for older payloads', () => {
    // Existing users' encrypted payloads predate these keys; they must decrypt
    // to empty arrays rather than throwing (spec §6.3 backward compatibility).
    const payload = encode(JSON.stringify({ pinnedConversations: ['c-1'] }));
    const parsed = parseUserPreferencesData(payload);

    expect(parsed.recentModels).toEqual([]);
    expect(parsed.hiddenModels).toEqual([]);
  });

  it('defaults toolModelDefaults to an empty map for older payloads', () => {
    // Per-context model defaults are new; older payloads must decrypt to {} so
    // toggling a tool resolves a default rather than throwing (tool-aware spec §5).
    const payload = encode(JSON.stringify({ pinnedConversations: ['c-1'] }));

    expect(parseUserPreferencesData(payload).toolModelDefaults).toEqual({});
  });

  it('defaults modelQuickFilter to null for older payloads', () => {
    const payload = encode(JSON.stringify({ pinnedConversations: ['c-1'] }));

    expect(parseUserPreferencesData(payload).modelQuickFilter).toBeNull();
  });

  it('defaults modelSortMode to recommended for older payloads', () => {
    const payload = encode(JSON.stringify({ pinnedConversations: ['c-1'] }));

    expect(parseUserPreferencesData(payload).modelSortMode).toBe('recommended');
  });

  it('rejects payloads missing pinnedConversations', () => {
    const payload = encode(JSON.stringify({ pinnedModels: [] }));
    expect(() => parseUserPreferencesData(payload)).toThrow();
  });

  it('rejects payloads where pinnedConversations is not an array', () => {
    const payload = encode(JSON.stringify({ pinnedConversations: 'c-1' }));
    expect(() => parseUserPreferencesData(payload)).toThrow();
  });

  it('rejects payloads where a pinnedConversation entry is not a string', () => {
    const payload = encode(JSON.stringify({ pinnedConversations: ['c-1', 42] }));
    expect(() => parseUserPreferencesData(payload)).toThrow();
  });

  it('rejects payloads that are not valid JSON', () => {
    const payload = encode('not json');
    expect(() => parseUserPreferencesData(payload)).toThrow();
  });
});

describe('serializeUserPreferencesData', () => {
  beforeAll(installFakeTextCodecs);
  afterAll(restoreTextCodecs);

  it('round-trips through parseUserPreferencesData', () => {
    const original: UserPreferencesData = {
      pinnedConversations: ['c-1', 'c-2'],
      pinnedModels: ['m-1'],
      pinnedPersonas: ['cognos:direct'],
      recentPersonas: ['cognos:editor'],
      defaultPersonaId: 'cognos:simple-assistant',
      defaultModelId: 'm-1',
      redactionEnabled: false,
      modelReasoningEfforts: { 'm-1': 'high' },
      recentModels: ['m-1', 'm-2'],
      hiddenModels: ['m-3'],
      toolModelDefaults: { image_generation: 'm-2' },
      modelQuickFilter: 'fast',
      modelSortMode: 'newest',
    };

    const serialized = serializeUserPreferencesData(original);
    expect(parseUserPreferencesData(serialized)).toEqual(original);
  });

  it('strips unknown fields so they cannot leak into ciphertext', () => {
    const withExtras = {
      pinnedConversations: ['c-1'],
      pinnedModels: ['m-1'],
      secret: 'should not be persisted',
    } as unknown as UserPreferencesData;

    const serialized = serializeUserPreferencesData(withExtras);
    const payload = JSON.parse(decode(serialized)) as Record<string, unknown>;

    expect(payload['pinnedConversations']).toEqual(['c-1']);
    expect(payload['pinnedModels']).toEqual(['m-1']);
    expect(payload['secret']).toBeUndefined();
  });
});
