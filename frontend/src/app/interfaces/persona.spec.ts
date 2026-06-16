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
    };

    expect(parsePersonaData(serializePersonaData(data))).toEqual(data);
  });

  it('rejects unsupported encrypted persona data versions', () => {
    const encoded = new TextEncoder().encode(
      JSON.stringify({ version: '2', name: 'x', description: 'y', system_prompt: 'z' }),
    );

    expect(() => parsePersonaData(encoded)).toThrow();
  });
});
