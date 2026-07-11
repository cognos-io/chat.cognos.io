import {
  ImportParseError,
  ImportPreview,
  ImportSource,
  ImportedConversation,
  ImportedMessage,
  emptyWarnings,
} from './import-types';

const MAX_JSON_BYTES = 250 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;
export const MAX_IMPORT_MESSAGES = 10_000;
export const MAX_IMPORT_CONVERSATIONS = 500;
const MAX_TEXT_LENGTH = 2_000_000;

export function parseImportJson(source: ImportSource, text: string): ImportPreview {
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new ImportParseError('too_large');
  }
  assertJsonDepth(text);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ImportParseError('invalid_json');
  }
  const conversations = source === 'chatgpt' ? parseChatGpt(value) : parseClaude(value);
  if (
    conversations.length > MAX_IMPORT_CONVERSATIONS ||
    conversations.reduce((sum, item) => sum + item.messages.length, 0) >
      MAX_IMPORT_MESSAGES
  ) {
    throw new ImportParseError('too_large');
  }
  return {
    source,
    conversations,
    totals: conversations.reduce(
      (total, conversation) => ({
        messages: total.messages + conversation.messages.length,
        attachments: total.attachments + conversation.warnings.attachments,
        images: total.images + conversation.warnings.images,
        tools: total.tools + conversation.warnings.tools,
        unsupported: total.unsupported + conversation.warnings.unsupported,
        ambiguousBranches:
          total.ambiguousBranches + conversation.warnings.ambiguousBranches,
      }),
      { messages: 0, ...emptyWarnings() },
    ),
  };
}

function parseChatGpt(value: unknown): ImportedConversation[] {
  if (!Array.isArray(value)) {
    throw new ImportParseError('unsupported_schema');
  }
  if (value.length > MAX_IMPORT_CONVERSATIONS) {
    throw new ImportParseError('too_large');
  }
  return value.flatMap((item, index) => parseChatGptConversation(item, index));
}

function parseChatGptConversation(
  value: unknown,
  index: number,
): ImportedConversation[] {
  if (!isRecord(value) || !isRecord(value['mapping'])) {
    throw new ImportParseError('unsupported_schema');
  }
  const mapping = value['mapping'];
  const nodes = new Map<
    string,
    { parent: string | null; message: ImportedMessage | null }
  >();
  const children = new Map<string, string[]>();
  const warnings = emptyWarnings();
  for (const [id, rawNode] of Object.entries(mapping)) {
    if (!isRecord(rawNode)) {
      throw new ImportParseError('unsupported_schema');
    }
    const parent = typeof rawNode['parent'] === 'string' ? rawNode['parent'] : null;
    const rawMessage = rawNode['message'];
    const message = mapChatGptMessage(id, parent, rawMessage, warnings);
    nodes.set(id, { parent, message });
    if (parent) {
      children.set(parent, [...(children.get(parent) ?? []), id]);
    }
  }
  const leaves = [...nodes.keys()].filter(
    (id) => (children.get(id)?.length ?? 0) === 0,
  );
  if (nodes.size > MAX_IMPORT_MESSAGES || leaves.length > MAX_IMPORT_CONVERSATIONS) {
    throw new ImportParseError('too_large');
  }
  const paths = leaves
    .map((leaf) => pathToRoot(leaf, nodes))
    .filter((path) => path.some((id) => nodes.get(id)?.message));
  if (paths.length === 0) {
    return [];
  }
  warnings.ambiguousBranches = Math.max(0, paths.length - 1);
  const baseTitle = safeText(value['title']) || `ChatGPT ${index + 1}`;
  return paths.map((path, branchIndex) => {
    const messages = path
      .map((id) => nodes.get(id)?.message ?? null)
      .filter((message): message is ImportedMessage => message !== null)
      .map((message, messageIndex, all) => ({
        ...message,
        parentSourceId: messageIndex === 0 ? null : all[messageIndex - 1].sourceId,
      }));
    return {
      sourceId: `${safeText(value['id']) || index}:${branchIndex}`,
      title: paths.length > 1 ? `${baseTitle} (${branchIndex + 1})` : baseTitle,
      createdAt: secondsToIso(value['create_time']),
      messages,
      warnings: branchIndex === 0 ? { ...warnings } : emptyWarnings(),
    };
  });
}

function mapChatGptMessage(
  id: string,
  parent: string | null,
  value: unknown,
  warnings: ReturnType<typeof emptyWarnings>,
): ImportedMessage | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isRecord(value) || !isRecord(value['author']) || !isRecord(value['content'])) {
    warnings.unsupported += 1;
    return null;
  }
  const role = value['author']['role'];
  if (role !== 'user' && role !== 'assistant') {
    if (role === 'tool') warnings.tools += 1;
    else warnings.unsupported += 1;
    return null;
  }
  const contentType = value['content']['content_type'];
  const parts = value['content']['parts'];
  if (contentType !== 'text' || !Array.isArray(parts)) {
    if (contentType === 'image_asset_pointer') warnings.images += 1;
    else warnings.unsupported += 1;
    return null;
  }
  const strings = parts.filter((part): part is string => typeof part === 'string');
  if (strings.length !== parts.length)
    warnings.attachments += parts.length - strings.length;
  const text = strings.join('\n').trim();
  if (!text) return null;
  assertTextLength(text);
  return {
    sourceId: id,
    parentSourceId: parent,
    role,
    text,
    createdAt: secondsToIso(value['create_time']),
  };
}

function parseClaude(value: unknown): ImportedConversation[] {
  if (!Array.isArray(value)) {
    throw new ImportParseError('unsupported_schema');
  }
  if (value.length > MAX_IMPORT_CONVERSATIONS) {
    throw new ImportParseError('too_large');
  }
  return value.map((item, index) => {
    if (!isRecord(item) || !Array.isArray(item['chat_messages'])) {
      throw new ImportParseError('unsupported_schema');
    }
    const warnings = emptyWarnings();
    const messages: ImportedMessage[] = [];
    for (const raw of item['chat_messages']) {
      if (!isRecord(raw)) {
        warnings.unsupported += 1;
        continue;
      }
      if (Array.isArray(raw['attachments']))
        warnings.attachments += raw['attachments'].length;
      if (Array.isArray(raw['files'])) warnings.attachments += raw['files'].length;
      const sender = raw['sender'];
      const role =
        sender === 'human' ? 'user' : sender === 'assistant' ? 'assistant' : null;
      const text = safeText(raw['text']).trim();
      if (!role || !text) {
        warnings.unsupported += 1;
        continue;
      }
      assertTextLength(text);
      const sourceId = safeText(raw['uuid']) || `${index}:${messages.length}`;
      messages.push({
        sourceId,
        parentSourceId: messages.at(-1)?.sourceId ?? null,
        role,
        text,
        createdAt: safeIso(raw['created_at']),
      });
    }
    return {
      sourceId: safeText(item['uuid']) || `${index}`,
      title: safeText(item['name']) || `Claude ${index + 1}`,
      createdAt: safeIso(item['created_at']),
      messages,
      warnings,
    };
  });
}

function pathToRoot(
  leaf: string,
  nodes: Map<string, { parent: string | null }>,
): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = leaf;
  while (cursor) {
    if (seen.has(cursor) || !nodes.has(cursor)) {
      throw new ImportParseError('unsupported_schema');
    }
    seen.add(cursor);
    path.push(cursor);
    cursor = nodes.get(cursor)?.parent ?? null;
  }
  return path.reverse();
}

function assertJsonDepth(text: string): void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{' || character === '[') {
      depth += 1;
      if (depth > MAX_JSON_DEPTH) throw new ImportParseError('too_deep');
    } else if (character === '}' || character === ']') depth -= 1;
  }
}

function assertTextLength(text: string): void {
  if (text.length > MAX_TEXT_LENGTH) throw new ImportParseError('too_large');
}

function secondsToIso(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : undefined;
}

function safeIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    return undefined;
  return new Date(value).toISOString();
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
