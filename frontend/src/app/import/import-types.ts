export type ImportSource = 'chatgpt' | 'claude';
export type ImportedRole = 'user' | 'assistant';

export interface ImportedMessage {
  sourceId: string;
  parentSourceId: string | null;
  role: ImportedRole;
  text: string;
  createdAt?: string;
}

export interface ImportedConversation {
  sourceId: string;
  title: string;
  createdAt?: string;
  messages: ImportedMessage[];
  warnings: ImportWarningCounts;
}

export interface ImportWarningCounts {
  attachments: number;
  images: number;
  tools: number;
  unsupported: number;
  ambiguousBranches: number;
}

export interface ImportPreview {
  source: ImportSource;
  conversations: ImportedConversation[];
  totals: ImportWarningCounts & { messages: number };
}

export type ImportFailureReason =
  | 'invalid_json'
  | 'unsupported_schema'
  | 'too_large'
  | 'too_deep'
  | 'persistence_failed';

export class ImportParseError extends Error {
  constructor(readonly reason: ImportFailureReason) {
    super(reason);
    this.name = 'ImportParseError';
  }
}

export const emptyWarnings = (): ImportWarningCounts => ({
  attachments: 0,
  images: 0,
  tools: 0,
  unsupported: 0,
  ambiguousBranches: 0,
});
