import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import PocketBase from 'pocketbase';

import { Observable, map } from 'rxjs';

import { environment } from '@environments/environment';

import { EncryptedAttachmentDraft } from './attachment.types';

/** Raw JSON shape returned by the attachment endpoints (snake_case). */
interface ApiAttachmentResponse {
  id: string;
  conversation: string;
  message?: string;
  size_bytes: number;
  files: string[];
  data: string;
  created: string;
  updated: string;
}

/** Decrypted-side view of a conversation_attachments record. */
export interface AttachmentRecord {
  id: string;
  conversation: string;
  message: string;
  sizeBytes: number;
  files: string[];
  data: string; // base64 sealed manifest
  created: string;
  updated: string;
}

const toRecord = (response: ApiAttachmentResponse): AttachmentRecord => ({
  id: response.id,
  conversation: response.conversation,
  message: response.message ?? '',
  sizeBytes: response.size_bytes,
  files: response.files ?? [],
  data: response.data,
  created: response.created,
  updated: response.updated,
});

/**
 * AttachmentUploadService talks to the conversation attachment endpoints. It
 * only ever sends/receives ciphertext (encrypted artifact blobs + the sealed
 * manifest); decryption happens client-side from the manifest.
 */
@Injectable({ providedIn: 'root' })
export class AttachmentUploadService {
  private readonly _http = inject(HttpClient);
  private readonly _pb = inject(PocketBase);
  private readonly _baseUrl = environment.pocketbaseBaseUrl;

  /** Upload an encrypted draft as a (message-less) draft attachment record. */
  upload(
    conversationId: string,
    draft: EncryptedAttachmentDraft,
  ): Observable<AttachmentRecord> {
    const form = new FormData();
    form.append('data', draft.manifestB64);
    // Files are uploaded in canonical order so files[i] maps to artifacts[i].
    draft.artifacts.forEach((artifact, index) => {
      // Copy into a plain ArrayBuffer so the Blob part type is unambiguous
      // (TS rejects a possibly-SharedArrayBuffer-backed Uint8Array).
      const buffer = artifact.ciphertext.buffer.slice(
        artifact.ciphertext.byteOffset,
        artifact.ciphertext.byteOffset + artifact.ciphertext.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([buffer], { type: 'application/octet-stream' });
      form.append('files', blob, `art-${index}.enc`);
    });

    return this._http
      .post<ApiAttachmentResponse>(
        `${this._baseUrl}/api/v1/conversations/${encodeURIComponent(conversationId)}/attachments`,
        form,
        { headers: this.authHeaders() },
      )
      .pipe(map(toRecord));
  }

  /** List every attachment record the user can access for a conversation. */
  list(conversationId: string): Observable<AttachmentRecord[]> {
    return this._http
      .get<
        ApiAttachmentResponse[]
      >(`${this._baseUrl}/api/v1/conversations/${encodeURIComponent(conversationId)}/attachments`, { headers: this.authHeaders() })
      .pipe(map((items) => (items ?? []).map(toRecord)));
  }

  /** Delete an unlinked draft attachment (e.g. removed before send). */
  deleteDraft(conversationId: string, attachmentId: string): Observable<void> {
    return this._http.delete<void>(
      `${this._baseUrl}/api/v1/conversations/${encodeURIComponent(
        conversationId,
      )}/attachments/${encodeURIComponent(attachmentId)}`,
      { headers: this.authHeaders() },
    );
  }

  /** Download one encrypted artifact's ciphertext bytes by server file name. */
  async downloadArtifact(
    conversationId: string,
    attachmentId: string,
    fileName: string,
  ): Promise<Uint8Array> {
    const url = `${this._baseUrl}/api/v1/conversations/${encodeURIComponent(
      conversationId,
    )}/attachments/${encodeURIComponent(attachmentId)}/files/${encodeURIComponent(fileName)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this._pb.authStore.token}` },
    });
    if (!response.ok) {
      throw new Error(`failed to fetch attachment artifact (${response.status})`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  private authHeaders(): HttpHeaders {
    const token = this._pb.authStore.token;
    return token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
  }
}
