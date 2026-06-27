import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import PocketBase from 'pocketbase';

import { Observable, map } from 'rxjs';

import { environment } from '@environments/environment';

import { EncryptedAttachmentDraft } from './attachment.types';

/** Raw JSON shape returned by the library attachment endpoints (snake_case). */
interface ApiAttachmentResponse {
  id: string;
  size_bytes: number;
  files: string[];
  data: string;
  created: string;
  updated: string;
}

/** Decrypted-side view of a user_attachments (library) record. */
export interface AttachmentRecord {
  id: string;
  sizeBytes: number;
  files: string[];
  data: string; // base64 sealed manifest (sealed to the owner's key)
  created: string;
  updated: string;
}

/** One place a library file is referenced (from the usages endpoint). */
export interface AttachmentUsage {
  conversation: string;
  message: string;
  created: string;
}

const toRecord = (response: ApiAttachmentResponse): AttachmentRecord => ({
  id: response.id,
  sizeBytes: response.size_bytes,
  files: response.files ?? [],
  data: response.data,
  created: response.created,
  updated: response.updated,
});

/**
 * AttachmentUploadService talks to the user-scoped library attachment endpoints.
 * It only ever sends/receives ciphertext (encrypted artifact blobs + the manifest
 * sealed to the owner's key); decryption happens client-side from the manifest.
 */
@Injectable({ providedIn: 'root' })
export class AttachmentUploadService {
  private readonly _http = inject(HttpClient);
  private readonly _pb = inject(PocketBase);
  private readonly _baseUrl = environment.pocketbaseBaseUrl;

  /** Upload an encrypted draft into the user's library. */
  upload(draft: EncryptedAttachmentDraft): Observable<AttachmentRecord> {
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
      .post<ApiAttachmentResponse>(`${this._baseUrl}/api/v1/attachments`, form, {
        headers: this.authHeaders(),
      })
      .pipe(map(toRecord));
  }

  /** List every library record the user owns (newest first). */
  list(): Observable<AttachmentRecord[]> {
    return this._http
      .get<ApiAttachmentResponse[]>(`${this._baseUrl}/api/v1/attachments`, {
        headers: this.authHeaders(),
      })
      .pipe(map((items) => (items ?? []).map(toRecord)));
  }

  /** Fetch a single library record by id (resolves a message's referenced file). */
  get(attachmentId: string): Observable<AttachmentRecord> {
    return this._http
      .get<ApiAttachmentResponse>(
        `${this._baseUrl}/api/v1/attachments/${encodeURIComponent(attachmentId)}`,
        { headers: this.authHeaders() },
      )
      .pipe(map(toRecord));
  }

  /** Replace the sealed manifest (used for rename — the display name lives in it). */
  updateManifest(
    attachmentId: string,
    manifestB64: string,
  ): Observable<AttachmentRecord> {
    return this._http
      .patch<ApiAttachmentResponse>(
        `${this._baseUrl}/api/v1/attachments/${encodeURIComponent(attachmentId)}`,
        { data: manifestB64 },
        { headers: this.authHeaders() },
      )
      .pipe(map(toRecord));
  }

  /** Remove a library file (allowed even if used — referencing chats tombstone). */
  remove(attachmentId: string): Observable<void> {
    return this._http.delete<void>(
      `${this._baseUrl}/api/v1/attachments/${encodeURIComponent(attachmentId)}`,
      { headers: this.authHeaders() },
    );
  }

  /** List the conversations/messages that reference a library file. */
  usages(attachmentId: string): Observable<AttachmentUsage[]> {
    return this._http
      .get<
        AttachmentUsage[]
      >(`${this._baseUrl}/api/v1/attachments/${encodeURIComponent(attachmentId)}/usages`, { headers: this.authHeaders() })
      .pipe(map((items) => items ?? []));
  }

  /** Download one encrypted artifact's ciphertext bytes by server file name. */
  async downloadArtifact(attachmentId: string, fileName: string): Promise<Uint8Array> {
    const url = `${this._baseUrl}/api/v1/attachments/${encodeURIComponent(
      attachmentId,
    )}/files/${encodeURIComponent(fileName)}`;
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
