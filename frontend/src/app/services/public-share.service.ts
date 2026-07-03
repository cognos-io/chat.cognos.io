import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

import { Observable, catchError, map, of, switchMap, tap, throwError } from 'rxjs';

import { Base64 } from 'js-base64';

import { Conversation } from '@app/interfaces/conversation';
import { KeyPair } from '@app/interfaces/key-pair';

import { Analytics } from './analytics/analytics';
import {
  type ApiCreatePublicShareResponse,
  CognosApiService,
  type PublicShareMode,
} from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { RedactionService } from './redaction.service';

// PublicShareLink describes a conversation's live public link: the URL plus the
// mode it was created with, so callers can tell whether sensitive values are
// restored for readers. The server echoes the effective mode, so this reflects
// any fallback (e.g. include-sensitive on a conversation with nothing redacted).
export interface PublicShareLink {
  url: string;
  mode: PublicShareMode;
}

// PublicShareService owns the client-side crypto for public links. The server
// only ever sees ciphertext + a throwaway public key; the secret half of the
// public-share keypair lives in the URL fragment and is never transmitted.
//
//   • share(): mint a link. We seal the conversation secret to a fresh
//     public-share public key (so an anonymous reader holding the fragment can
//     recover it) and seal the fragment secret to the conversation public key
//     (so any participant can rebuild the same link).
//   • existingShare(): a participant rebuilds the live link from the
//     server-held share_secret using the conversation keypair they already
//     hold, alongside its mode. 404 → not shared → null.
@Injectable({
  providedIn: 'root',
})
export class PublicShareService {
  private readonly _api = inject(CognosApiService);
  private readonly _crypto = inject(CryptoService);
  private readonly _redaction = inject(RedactionService);
  private readonly _document = inject(DOCUMENT);
  private readonly _analytics = inject(Analytics);

  // share mints a public link. Redacted-only (default) hands the reader only the
  // conversation key, so PII placeholders stay placeholders. Include-sensitive
  // additionally seals the conversation's redaction secret to the share key, so
  // an anonymous reader holding the fragment can hydrate the originals.
  share(
    conversation: Conversation,
    mode: PublicShareMode = 'redacted_only',
  ): Observable<PublicShareLink> {
    const publicShareKeyPair = this._crypto.newKeyPair();

    const wrappedConversationSecretKey = this._crypto.createSealedBox(
      conversation.keyPair.secretKey,
      publicShareKeyPair.publicKey,
    );
    const shareSecret = this._crypto.createSealedBox(
      publicShareKeyPair.secretKey,
      conversation.keyPair.publicKey,
    );

    const base = {
      public_key: Base64.fromUint8Array(publicShareKeyPair.publicKey),
      wrapped_conversation_secret_key: Base64.fromUint8Array(
        wrappedConversationSecretKey,
      ),
      share_secret: Base64.fromUint8Array(shareSecret),
    };

    const create$: Observable<ApiCreatePublicShareResponse> =
      mode === 'include_sensitive'
        ? this._redaction.keyPairFor(conversation).pipe(
            switchMap((redactionKeyPair) => {
              if (!redactionKeyPair) {
                // Nothing redacted in this conversation — fall back to the safe
                // mode rather than minting an empty include-sensitive share.
                return this._api.createPublicShare(conversation.record.id, {
                  ...base,
                  mode: 'redacted_only',
                });
              }
              const wrappedRedactionSecretKey = this._crypto.createSealedBox(
                redactionKeyPair.secretKey,
                publicShareKeyPair.publicKey,
              );
              return this._api.createPublicShare(conversation.record.id, {
                ...base,
                mode: 'include_sensitive',
                wrapped_redaction_secret_key: Base64.fromUint8Array(
                  wrappedRedactionSecretKey,
                ),
                redaction_public_key: Base64.fromUint8Array(redactionKeyPair.publicKey),
              });
            }),
          )
        : this._api.createPublicShare(conversation.record.id, {
            ...base,
            mode: 'redacted_only',
          });

    return create$.pipe(
      // Adoption only — never the token, URL, or mode of a specific share.
      tap(() => this._analytics.track('share_created')),
      map(
        (res): PublicShareLink => ({
          url: this.buildShareUrl(res.token, publicShareKeyPair.secretKey),
          mode: res.mode,
        }),
      ),
    );
  }

  existingShare(conversation: Conversation): Observable<PublicShareLink | null> {
    return this._api.getPublicShare(conversation.record.id).pipe(
      map((res): PublicShareLink => {
        const publicShareSecretKey = this._crypto.openSealedBox(
          Base64.toUint8Array(res.share_secret),
          conversation.keyPair,
        );
        return {
          url: this.buildShareUrl(res.token, publicShareSecretKey),
          mode: res.mode,
        };
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
