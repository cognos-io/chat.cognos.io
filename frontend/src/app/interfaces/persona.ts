import { z } from 'zod';

import { Tag } from './tag';

export const Persona = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  tags: z.array(Tag).optional(),
  authorId: z.string(),
  recordId: z.string().optional(),
  source: z.enum(['cognos', 'user']).default('user'),
});
export type Persona = z.infer<typeof Persona>;

export const EncryptedPersonaData = z.object({
  version: z.literal('1'),
  name: z.string(),
  description: z.string(),
  system_prompt: z.string(),
});
export type EncryptedPersonaData = z.infer<typeof EncryptedPersonaData>;

export function serializePersonaData(data: EncryptedPersonaData): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(data));
}

export function parsePersonaData(decryptedData: Uint8Array): EncryptedPersonaData {
  const dataString = new TextDecoder().decode(decryptedData);
  return EncryptedPersonaData.parse(JSON.parse(dataString));
}

export function parsePersonaMarkdown(markdown: string): Persona {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error('Persona markdown must start with frontmatter');
  }

  const frontmatter = Object.fromEntries(
    match[1].split('\n').map((line) => {
      const separator = line.indexOf(':');
      if (separator === -1) {
        throw new Error('Persona frontmatter must use key: value lines');
      }
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }),
  );
  const systemPrompt = match[2].trim();

  if (!systemPrompt) {
    throw new Error('Persona markdown must include a system prompt');
  }

  return Persona.parse({
    id: frontmatter['id'],
    name: frontmatter['name'],
    description: frontmatter['description'],
    systemPrompt,
    authorId: 'cognos',
    source: 'cognos',
    tags: [{ title: 'official', color: { palette: 'primary' }, featured: true }],
  });
}

export const defaultPersonaId = 'cognos:simple-assistant';
export const generateConversationPersonaId = 'cognos:generate-conversation-persona';
export const generateConversationSystemPrompt =
  'Generate a 3 to 5 word title for the conversation from the user message. Return only the title.';
