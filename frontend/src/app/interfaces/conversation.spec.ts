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
});
