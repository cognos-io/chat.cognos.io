import { Injectable, inject } from '@angular/core';

import { firstValueFrom } from 'rxjs';

import { zipSync } from 'fflate';
import { Base64 } from 'js-base64';

import {
  AttachmentLibraryService,
  LibraryFile,
} from '@app/attachments/attachment-library.service';
import { Conversation } from '@app/interfaces/conversation';
import {
  MessageAttachment,
  MessageData,
  isMessageFromUser,
  parseMessageData,
} from '@app/interfaces/message';
import { saveBlob } from '@app/utils/save-blob';

import { CognosApiService } from './cognos-api.service';
import { CompactionService } from './compaction.service';
import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';
import { PersonaService } from './persona.service';
import { ProjectService } from './project.service';
import { ScopedMemoryService } from './scoped-memory.service';

const MESSAGE_PAGE_SIZE = 100;

// Skip library files larger than this from the export archive (recorded as
// skipped in the manifest instead). Library uploads are already capped at
// 10 MiB, so this is a safety net for an unexpectedly large stored original.
const MAX_EXPORTED_ATTACHMENT_BYTES = 25 * 1024 * 1024;
// Total budget for bundled library files, so an export of a big library stays a
// reasonable download. Files that don't fit are recorded as skipped.
const MAX_EXPORTED_ATTACHMENT_TOTAL_BYTES = 200 * 1024 * 1024;

// ExportedAttachment references a decrypted image bundled alongside the JSON in
// the export archive. `file` is the archive-relative path to the image bytes.
export interface ExportedAttachment {
  kind: string;
  mime_type: string;
  file: string;
  width?: number;
  height?: number;
}

export interface ExportedMessage {
  record_id?: string;
  // The record id of the message this one replies to, preserving the thread
  // structure (which assistant reply answers which prompt) in the export.
  parent_message_id?: string;
  created_at?: string;
  role: 'user' | 'assistant';
  content: string | null;
  model_id?: string;
  persona_id?: string;
  // Decrypted image attachments, each pointing at a file in the archive.
  attachments?: ExportedAttachment[];
}

// The decrypted binary files gathered during an export, keyed by their
// archive-relative path. Covers both generated images (images/) and library
// files (files/).
type ExportArchive = Map<string, Uint8Array>;

const EXPORT_JSON_NAME = 'export.json';

export interface ExportedConversation {
  id: string;
  title: string;
  created: string;
  updated: string;
  // The project this conversation belongs to, if any. This is the mapping of
  // which conversations live under which project (see `projects` below).
  project_id?: string;
  messages: ExportedMessage[];
}

// A custom persona the user authored (Cognos-provided personas are omitted —
// they are not the user's data and are the same for everyone).
export interface ExportedPersona {
  id: string;
  record_id?: string;
  name: string;
  description: string;
  system_prompt: string;
  icon: string;
  color: string;
}

// A user project/folder's decrypted metadata. Conversation membership is
// captured on each conversation's `project_id`.
export interface ExportedProject {
  id: string;
  name: string;
  description: string;
  instructions: string;
  icon: string;
  color: string;
  created: string;
  updated: string;
}

// A single memory scope's decrypted items (durable memory bullet list).
export interface ExportedScopedMemory {
  items: string[];
}

// A project-scoped memory record, tagged with its project id.
export interface ExportedProjectMemory extends ExportedScopedMemory {
  project_id: string;
}

// One conversation compaction (durable memory + rolling narrative) — the
// persisted, decrypted long-conversation memory for a conversation.
export interface ExportedCompaction {
  conversation_id: string;
  record_id: string;
  created_at: string;
  output_mode: string;
  durable_memory: string[];
  rolling_narrative: string;
}

export interface ExportedMemory {
  // The user's personal memory, or null when none is stored.
  user: ExportedScopedMemory | null;
  // Per-project memory scopes.
  projects: ExportedProjectMemory[];
  // Per-conversation compactions (durable conversation memory).
  compactions: ExportedCompaction[];
}

// A user-uploaded library file. `file` is the archive path when the bytes were
// bundled; `skipped` gives the reason when they were not (too large, or the
// file could not be decrypted) so the export never fails on one bad file.
export interface ExportedLibraryAttachment {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  file?: string;
  skipped?: string;
}

export interface ExportPayload {
  // v2 adds personas, memory, projects and library attachments to the v1
  // conversations/messages. v1 consumers reading `conversations` still work.
  version: '2';
  exported_at: string;
  conversation_count: number;
  conversations: ExportedConversation[];
  // Account-wide sections. Populated for a full-account export; empty/null for a
  // single-conversation export (which only carries that conversation).
  personas: ExportedPersona[];
  projects: ExportedProject[];
  memory: ExportedMemory;
  attachments: ExportedLibraryAttachment[];
}

// ExportService gathers the user's data and decrypts it in the browser into a
// single downloadable payload. Decryption happens client-side only — no
// plaintext ever leaves the device — which is the whole point of an export for
// an end-to-end encrypted product. A full-account export additionally bundles
// custom personas, scoped memory, projects and the user's uploaded files.
@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly _api = inject(CognosApiService);
  private readonly _conversations = inject(ConversationService);
  private readonly _crypto = inject(CryptoService);
  private readonly _personas = inject(PersonaService);
  private readonly _projects = inject(ProjectService);
  private readonly _memory = inject(ScopedMemoryService);
  private readonly _compactions = inject(CompactionService);
  private readonly _library = inject(AttachmentLibraryService);

  async buildExport(now: Date): Promise<ExportPayload> {
    const { payload } = await this.gather(this.allConversations(), now, true);
    return payload;
  }

  // downloadExport builds the payload and triggers a browser download. When the
  // export carries any binary data (generated images or library files) the
  // download is a .zip bundling the JSON with those files; otherwise it stays a
  // plain .json.
  async downloadExport(now: Date): Promise<ExportPayload> {
    const { payload, archive } = await this.gather(this.allConversations(), now, true);
    this.deliver(payload, archive, `cognos-export-${now.toISOString().slice(0, 10)}`);
    return payload;
  }

  // Single-conversation variant, sharing the export format (one entry) so the
  // file reads the same whether one chat or all of them were exported. Only that
  // conversation and its compactions are included — not account-wide sections.
  async buildConversationExport(
    conversation: Conversation,
    now: Date,
  ): Promise<ExportPayload> {
    const { payload } = await this.gather([conversation], now, false);
    return payload;
  }

  async downloadConversationExport(
    conversation: Conversation,
    now: Date,
  ): Promise<ExportPayload> {
    const { payload, archive } = await this.gather([conversation], now, false);
    this.deliver(payload, archive, this.conversationFilename(conversation, now));
    return payload;
  }

  // A full export covers every loaded conversation — standalone AND project
  // conversations (the latter are excluded from the sidebar list but are part of
  // the user's data, and back the project→conversation mapping).
  private allConversations(): Conversation[] {
    return this._conversations.allConversations();
  }

  // gather decrypts every conversation's messages/attachments/compactions, and
  // — for a full-account export — the user's personas, projects, scoped memory
  // and library files, accumulating any binary bytes into a single archive map.
  private async gather(
    conversations: Conversation[],
    now: Date,
    fullAccount: boolean,
  ): Promise<{ payload: ExportPayload; archive: ExportArchive }> {
    const archive: ExportArchive = new Map();
    const exported: ExportedConversation[] = [];
    const compactions: ExportedCompaction[] = [];
    for (const conversation of conversations) {
      exported.push(await this.exportConversation(conversation, archive));
      compactions.push(...(await this.exportCompactions(conversation)));
    }

    const personas = fullAccount ? this.exportPersonas() : [];
    const projects = fullAccount ? this.exportProjects() : [];
    const userMemory = fullAccount ? await this.exportUserMemory() : null;
    const projectMemory = fullAccount ? await this.exportProjectMemory() : [];
    const attachments = fullAccount ? await this.exportLibrary(archive) : [];

    const payload: ExportPayload = {
      version: '2',
      exported_at: now.toISOString(),
      conversation_count: exported.length,
      conversations: exported,
      personas,
      projects,
      memory: { user: userMemory, projects: projectMemory, compactions },
      attachments,
    };
    return { payload, archive };
  }

  private async exportConversation(
    conversation: Conversation,
    archive: ExportArchive,
  ): Promise<ExportedConversation> {
    return {
      id: conversation.record.id,
      title: conversation.decryptedData.title,
      created: conversation.record.created,
      updated: conversation.record.updated,
      project_id: conversation.record.project || undefined,
      messages: await this.exportMessages(conversation, archive),
    };
  }

  private async exportMessages(
    conversation: Conversation,
    archive: ExportArchive,
  ): Promise<ExportedMessage[]> {
    const messages: ExportedMessage[] = [];

    let page = 1;
    let totalPages: number;
    do {
      const response = await firstValueFrom(
        this._api.listConversationMessages(
          conversation.record.id,
          page,
          MESSAGE_PAGE_SIZE,
        ),
      );
      totalPages = response.totalPages;

      for (const record of response.items) {
        const data = this.decrypt(record.data, conversation);
        messages.push({
          record_id: record.id,
          parent_message_id: data.parent_message_id,
          created_at: data.created_at,
          role: isMessageFromUser(data) ? 'user' : 'assistant',
          content: data.content,
          model_id: data.model_id,
          persona_id: data.persona_id,
          attachments: await this.exportAttachments(
            conversation,
            record.id,
            data.attachments,
            archive,
          ),
        });
      }

      page += 1;
    } while (page <= totalPages);

    // The list endpoint returns newest-first; export oldest-first so the file
    // reads as a transcript.
    return messages.sort((a, b) =>
      (a.created_at ?? '').localeCompare(b.created_at ?? ''),
    );
  }

  // exportAttachments fetches and decrypts each image attachment, adds the bytes
  // to the archive, and returns the JSON references. Returns undefined when the
  // message has no attachments (so the field stays absent for text turns). A
  // failed fetch/decrypt skips that image rather than failing the whole export.
  private async exportAttachments(
    conversation: Conversation,
    messageId: string,
    attachments: MessageAttachment[] | undefined,
    archive: ExportArchive,
  ): Promise<ExportedAttachment[] | undefined> {
    if (!attachments?.length) {
      return undefined;
    }

    const exported: ExportedAttachment[] = [];
    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index];
      const bytes = await this.decryptAttachment(conversation, messageId, attachment);
      if (!bytes) {
        continue;
      }
      const file = `images/${messageId}-${index}.${extForMime(attachment.mime_type)}`;
      archive.set(file, bytes);
      exported.push({
        kind: attachment.kind,
        mime_type: attachment.mime_type,
        file,
        width: attachment.width,
        height: attachment.height,
      });
    }

    return exported.length ? exported : undefined;
  }

  private async decryptAttachment(
    conversation: Conversation,
    messageId: string,
    attachment: MessageAttachment,
  ): Promise<Uint8Array | null> {
    try {
      const ciphertext = await firstValueFrom(
        this._api.fetchAttachmentBytes(conversation.record.id, messageId),
      );
      // Only generated images carry a sealed_key + bytes on the message record;
      // user uploads have none here, so there is nothing to decrypt for export.
      if (!attachment.sealed_key) {
        return null;
      }
      const symmetricKey = this._crypto.openSealedBox(
        Base64.toUint8Array(attachment.sealed_key),
        conversation.keyPair,
      );
      return this._crypto.openSecretBox(ciphertext, symmetricKey);
    } catch {
      return null;
    }
  }

  // exportCompactions loads and decrypts a conversation's compactions (its
  // persisted durable/rolling memory). A failed load degrades to no compactions
  // for that conversation rather than failing the whole export.
  private async exportCompactions(
    conversation: Conversation,
  ): Promise<ExportedCompaction[]> {
    try {
      const compactions = await firstValueFrom(
        this._compactions.load(conversation.record.id, conversation.keyPair),
      );
      return compactions.map((compaction) => ({
        conversation_id: compaction.conversationId,
        record_id: compaction.recordId,
        created_at: compaction.payload.created_at,
        output_mode: compaction.payload.output_mode,
        durable_memory: compaction.payload.durable_memory.items,
        rolling_narrative: compaction.payload.rolling_narrative,
      }));
    } catch {
      return [];
    }
  }

  // exportPersonas returns the user's custom personas (already decrypted in the
  // PersonaService cache). Cognos-provided personas are not the user's data and
  // are omitted.
  private exportPersonas(): ExportedPersona[] {
    return this._personas.customPersonas().map((persona) => ({
      id: persona.id,
      record_id: persona.recordId,
      name: persona.name,
      description: persona.description,
      system_prompt: persona.systemPrompt,
      icon: persona.icon,
      color: persona.color,
    }));
  }

  // exportProjects returns the user's projects (already decrypted in the
  // ProjectService cache). Conversation membership is on each conversation's
  // project_id.
  private exportProjects(): ExportedProject[] {
    return this._projects.projects().map((project) => ({
      id: project.record.id,
      name: project.decryptedData.name,
      description: project.decryptedData.description,
      instructions: project.decryptedData.instructions,
      icon: project.decryptedData.icon,
      color: project.decryptedData.color,
      created: project.record.created,
      updated: project.record.updated,
    }));
  }

  // exportUserMemory loads and decrypts the user's personal memory. Degrades to
  // null when none is stored or it cannot be loaded.
  private async exportUserMemory(): Promise<ExportedScopedMemory | null> {
    try {
      const memory = await firstValueFrom(this._memory.loadUserMemory());
      if (!memory) {
        return null;
      }
      return { items: memory.payload.durable_memory.items };
    } catch {
      return null;
    }
  }

  // exportProjectMemory loads and decrypts each project's memory scope. A scope
  // that fails to load or is empty is omitted.
  private async exportProjectMemory(): Promise<ExportedProjectMemory[]> {
    const result: ExportedProjectMemory[] = [];
    for (const project of this._projects.projects()) {
      try {
        const memory = await firstValueFrom(
          this._memory.loadProjectMemory(project.record.id),
        );
        if (memory) {
          result.push({
            project_id: project.record.id,
            items: memory.payload.durable_memory.items,
          });
        }
      } catch {
        // Skip a project memory scope that can't be loaded.
      }
    }
    return result;
  }

  // exportLibrary decrypts each user-uploaded library file into the archive and
  // returns a manifest. Files that are too large or fail to decrypt are recorded
  // as skipped-with-reason rather than failing the whole export.
  private async exportLibrary(
    archive: ExportArchive,
  ): Promise<ExportedLibraryAttachment[]> {
    let files: LibraryFile[];
    try {
      files = await firstValueFrom(this._library.refresh());
    } catch {
      return [];
    }

    const manifest: ExportedLibraryAttachment[] = [];
    let totalBytes = 0;
    for (const file of files) {
      const entry: ExportedLibraryAttachment = {
        id: file.id,
        name: file.displayName,
        mime_type: file.mimeType,
        size_bytes: file.sizeBytes,
        created_at: file.createdAt,
      };

      if (file.sizeBytes > MAX_EXPORTED_ATTACHMENT_BYTES) {
        entry.skipped = 'file_too_large';
        manifest.push(entry);
        continue;
      }
      if (totalBytes + file.sizeBytes > MAX_EXPORTED_ATTACHMENT_TOTAL_BYTES) {
        entry.skipped = 'export_size_limit';
        manifest.push(entry);
        continue;
      }

      try {
        const bytes = await this._library.decryptOriginal(file);
        const path = `files/${file.id}-${sanitizeFilename(file.displayName)}`;
        archive.set(path, bytes);
        totalBytes += bytes.byteLength;
        entry.file = path;
      } catch {
        entry.skipped = 'decrypt_failed';
      }
      manifest.push(entry);
    }
    return manifest;
  }

  private decrypt(base64Data: string, conversation: Conversation): MessageData {
    try {
      return parseMessageData(
        this._crypto.openSealedBox(
          Base64.toUint8Array(base64Data),
          conversation.keyPair,
        ),
      );
    } catch {
      return { content: null };
    }
  }

  // Filename for a single chat: a slug of its title (falling back to the id)
  // plus the export date.
  private conversationFilename(conversation: Conversation, now: Date): string {
    const slug = conversation.decryptedData.title
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
    const base = slug || conversation.record.id;
    return `cognos-${base}-${now.toISOString().slice(0, 10)}`;
  }

  // deliver downloads the export: a plain .json when there is no binary data, or
  // a .zip bundling export.json with the decrypted images/ and files/ folders
  // otherwise.
  private deliver(
    payload: ExportPayload,
    archive: ExportArchive,
    filename: string,
  ): void {
    const json = JSON.stringify(payload, null, 2);

    if (archive.size === 0) {
      this.download(new Blob([json], { type: 'application/json' }), `${filename}.json`);
      return;
    }

    const files: Record<string, Uint8Array> = {
      [EXPORT_JSON_NAME]: new TextEncoder().encode(json),
    };
    for (const [path, bytes] of archive) {
      files[path] = bytes;
    }
    const zipped = zipSync(files);
    this.download(
      new Blob([zipped as BlobPart], { type: 'application/zip' }),
      `${filename}.zip`,
    );
  }

  private download(blob: Blob, filename: string): void {
    saveBlob(blob, filename);
  }
}

function extForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'png';
  }
}

// sanitizeFilename keeps archive paths safe and predictable: a conservative
// slug of the original name (which the user chose and could contain anything).
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'file';
}
