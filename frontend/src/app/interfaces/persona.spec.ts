import { describe, expect, it } from 'vitest';

import {
  EncryptedPersonaData,
  parsePersonaData,
  parsePersonaMarkdown,
  serializePersonaData,
} from './persona';

describe('parsePersonaMarkdown', () => {
  it('parses frontmatter and prompt body', () => {
    const persona = parsePersonaMarkdown(`---
id: cognos:test
name: Test Persona
description: Helps with tests.
---

You are useful.`);

    expect(persona).toMatchObject({
      id: 'cognos:test',
      name: 'Test Persona',
      description: 'Helps with tests.',
      systemPrompt: 'You are useful.',
      authorId: 'cognos',
      source: 'cognos',
    });
  });

  it('rejects markdown without frontmatter', () => {
    expect(() => parsePersonaMarkdown('You are useful.')).toThrow(/frontmatter/);
  });

  it('rejects markdown without a prompt body', () => {
    expect(() =>
      parsePersonaMarkdown(`---
id: cognos:test
name: Test Persona
description: Helps with tests.
---
`),
    ).toThrow(/system prompt/);
  });
});

describe('persona encrypted payload', () => {
  it('round-trips valid encrypted persona data', () => {
    const data: EncryptedPersonaData = {
      version: '1',
      name: 'Private coach',
      description: 'Hidden metadata',
      system_prompt: 'Private prompt',
      icon: 'pencil',
      color: 'teal',
    };

    expect(parsePersonaData(serializePersonaData(data))).toEqual(data);
  });

  it('defaults icon and colour when the payload omits them', () => {
    const encoded = new TextEncoder().encode(
      JSON.stringify({
        version: '1',
        name: 'Legacy',
        description: 'Saved before icons existed',
        system_prompt: 'Hello',
      }),
    );

    expect(parsePersonaData(encoded)).toMatchObject({
      icon: 'sparkles',
      color: 'slate',
    });
  });

  it('coerces unknown icon and colour values to defaults', () => {
    const encoded = new TextEncoder().encode(
      JSON.stringify({
        version: '1',
        name: 'Odd',
        description: 'Has nonsense icon',
        system_prompt: 'Hello',
        icon: 'not-a-real-icon',
        color: 'chartreuse',
      }),
    );

    expect(parsePersonaData(encoded)).toMatchObject({
      icon: 'sparkles',
      color: 'slate',
    });
  });

  it('rejects unsupported encrypted persona data versions', () => {
    const encoded = new TextEncoder().encode(
      JSON.stringify({ version: '2', name: 'x', description: 'y', system_prompt: 'z' }),
    );

    expect(() => parsePersonaData(encoded)).toThrow();
  });
});
