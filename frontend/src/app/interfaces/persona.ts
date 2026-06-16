import { z } from 'zod';

import type { CognosIconName } from '@cognos/ui/icons';

import { Tag } from './tag';

// Curated subset of the icon set that reads well as a persona avatar. The
// editor renders these as the icon picker grid, so the order here is the
// order shown to the user.
export const personaIcons = [
  'sparkles',
  'message-square',
  'gauge',
  'git-branch',
  'graduation-cap',
  'pencil',
  'search',
  'book-text',
  'landmark',
  'scale',
  'languages',
  'file-text',
  'quote',
  'shield',
  'server',
  'cloud',
  'users',
  'table',
  'layout-grid',
  'calendar',
  'credit-card',
  'laptop',
  'monitor-smartphone',
  'key-round',
] as const satisfies readonly CognosIconName[];

export type PersonaIcon = (typeof personaIcons)[number];
export const defaultPersonaIcon: PersonaIcon = 'sparkles';

// Pastel palettes for the persona avatar. Each key maps to a background/
// foreground token pair defined in the persona card and editor styles.
export const personaColors = [
  'green',
  'blue',
  'indigo',
  'violet',
  'teal',
  'sky',
  'amber',
  'orange',
  'pink',
  'slate',
] as const;

export type PersonaColor = (typeof personaColors)[number];
export const defaultPersonaColor: PersonaColor = 'slate';

export function coercePersonaIcon(value: unknown): PersonaIcon {
  return typeof value === 'string' &&
    (personaIcons as readonly string[]).includes(value)
    ? (value as PersonaIcon)
    : defaultPersonaIcon;
}

export function coercePersonaColor(value: unknown): PersonaColor {
  return typeof value === 'string' &&
    (personaColors as readonly string[]).includes(value)
    ? (value as PersonaColor)
    : defaultPersonaColor;
}

// Unknown/missing/legacy icon and colour values coerce to a safe default so
// payloads written before these fields existed still parse.
const PersonaIconValue = z.unknown().transform(coercePersonaIcon);
const PersonaColorValue = z.unknown().transform(coercePersonaColor);

export const Persona = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  icon: PersonaIconValue,
  color: PersonaColorValue,
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
  icon: PersonaIconValue,
  color: PersonaColorValue,
});
export type EncryptedPersonaData = z.infer<typeof EncryptedPersonaData>;

export function serializePersonaData(data: EncryptedPersonaData): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(EncryptedPersonaData.parse(data)));
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
    icon: frontmatter['icon'] ?? defaultPersonaIcon,
    color: frontmatter['color'] ?? defaultPersonaColor,
    authorId: 'cognos',
    source: 'cognos',
    tags: [{ title: 'official', color: { palette: 'primary' }, featured: true }],
  });
}

export const defaultPersonaId = 'cognos:simple-assistant';
export const generateConversationPersonaId = 'cognos:generate-conversation-persona';
export const generateConversationSystemPrompt =
  'Generate a 3 to 5 word title for the conversation from the user message. Return only the title.';
