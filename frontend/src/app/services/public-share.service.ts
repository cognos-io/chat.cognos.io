import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

import { Observable, catchError, map, of, throwError } from 'rxjs';

import { Base64 } from 'js-base64';

import { Conversation } from '@app/interfaces/conversation';
import { KeyPair } from '@app/interfaces/key-pair';

import { CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';

// PublicShareService owns the client-side crypto for public links. The server
// only ever sees ciphertext + a throwaway public key; the secret half of the
// public-share keypair lives in the URL fragment and is never transmitted.
//
//   • share(): mint a link. We seal the conversation secret to a fresh
//     public-share public key (so an anonymous reader holding the fragment can
//     recover it) and seal the fragment secret to the conversation public key
//     (so any participant can rebuild the same link).
//   • existingShareUrl(): a participant rebuilds the live link from the
//     server-held share_secret using the conversation keypair they already
//     hold. 404 → not shared → null.
@Injectable({
  providedIn: 'root',
})
export class PublicShareService {
  private readonly _api = inject(CognosApiService);
  private readonly _crypto = inject(CryptoService);
  private readonly _document = inject(DOCUMENT);

  share(conversation: Conversation): Observable<string> {
    const publicShareKeyPair = this._crypto.newKeyPair();

    const wrappedConversationSecretKey = this._crypto.createSealedBox(
      conversation.keyPair.secretKey,
      publicShareKeyPair.publicKey,
    );
    const shareSecret = this._crypto.createSealedBox(
      publicShareKeyPair.secretKey,
      conversation.keyPair.publicKey,
    );

    return this._api
      .createPublicShare(conversation.record.id, {
        public_key: Base64.fromUint8Array(publicShareKeyPair.publicKey),
        wrapped_conversation_secret_key: Base64.fromUint8Array(
          wrappedConversationSecretKey,
        ),
        share_secret: Base64.fromUint8Array(shareSecret),
      })
      .pipe(map((res) => this.buildShareUrl(res.token, publicShareKeyPair.secretKey)));
  }

  existingShareUrl(conversation: Conversation): Observable<string | null> {
    return this._api.getPublicShare(conversation.record.id).pipe(
      map((res) => {
        const publicShareSecretKey = this._crypto.openSealedBox(
          Base64.toUint8Array(res.share_secret),
          conversation.keyPair,
        );
        return this.buildShareUrl(res.token, publicShareSecretKey);
      }),
      catchError((err: { status?: number }) =>
        err?.status === 404 ? of(null) : throwError(() => err),
      ),
    );
  }

  // revoke deletes the share so the public URL 404s immediately. We don't
  // rotate the conversation key: the public read endpoint is the only
  // unauthenticated path to the ciphertext, so removing the share already cuts
  // off all future public access while keeping the owner's conversation
  // readable.
  revoke(conversation: Conversation): Observable<void> {
    return this._api.deletePublicShare(conversation.record.id);
  }

  // buildShareUrl assembles /p/<token>#<url-safe-base64 secret>. The secret in
  // the fragment never reaches the server (the browser strips fragments from
  // requests), so it stays client-only by construction.
  buildShareUrl(token: string, secretKey: KeyPair['secretKey']): string {
    const fragment = Base64.fromUint8Array(secretKey, true);
    return `${this.origin()}/p/${token}#${fragment}`;
  }

  private origin(): string {
    return this._document.defaultView?.location.origin ?? '';
  }
}
