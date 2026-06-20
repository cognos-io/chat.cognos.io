import { TestBed } from '@angular/core/testing';

import { Observable, firstValueFrom, of, throwError } from 'rxjs';

import { Base64 } from 'js-base64';
import { describe, expect, it } from 'vitest';

import { Conversation } from '@app/interfaces/conversation';

import {
  ApiCreatePublicShareResponse,
  ApiParticipantPublicShareResponse,
  CognosApiService,
} from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { PublicShareService } from './public-share.service';
import { RedactionService } from './redaction.service';

// A minimal stand-in for the parts of CognosApiService the share service uses.
// createPublicShare records the request so the crypto can be inspected.
class ApiStub {
  lastConversationId: string | null = null;
  lastCreateRequest: {
    public_key: string;
    wrapped_conversation_secret_key: string;
    share_secret: string;
  } | null = null;
  createResponse: ApiCreatePublicShareResponse = {
    token: 'tok123',
    key_version: 1,
    mode: 'redacted_only',
  };
  getResponse: ApiParticipantPublicShareResponse | { status: number } = { status: 404 };

  createPublicShare(
    conversationId: string,
    request: {
      public_key: string;
      wrapped_conversation_secret_key: string;
      share_secret: string;
    },
  ): Observable<ApiCreatePublicShareResponse> {
    this.lastConversationId = conversationId;
    this.lastCreateRequest = request;
    return of(this.createResponse);
  }

  getPublicShare(
    conversationId: string,
  ): Observable<ApiParticipantPublicShareResponse> {
    this.lastConversationId = conversationId;
    if ('status' in this.getResponse) {
      return throwError(() => this.getResponse);
    }
    return of(this.getResponse);
  }

  deletedConversationId: string | null = null;
  deletePublicShare(conversationId: string): Observable<void> {
    this.deletedConversationId = conversationId;
    return of(undefined);
  }
}

describe('PublicShareService', () => {
  let service: PublicShareService;
  let crypto: CryptoService;
  let api: ApiStub;

  // Build a conversation with a real conversation keypair so the wrapping
  // round-trips can be verified end-to-end.
  const buildConversation = (cryptoService: CryptoService): Conversation => {
    const keyPair = cryptoService.newKeyPair();
    return {
      record: {
        id: 'conv_test',
        created: '2026-06-14 00:00:00.000Z',
        updated: '2026-06-14 00:00:00.000Z',
        data: '',
      },
      decryptedData: { title: 'Test' },
      keyPair,
    };
  };

  const fragmentOf = (url: string): string => url.split('#')[1] ?? '';

  beforeEach(() => {
    api = new ApiStub();
    TestBed.configureTestingModule({
      providers: [
        { provide: CognosApiService, useValue: api },
        // Default (redacted-only) shares never touch redaction; stub it so the
        // real service (and its conversation dependency) isn't constructed.
        { provide: RedactionService, useValue: { keyPairFor: () => of(null) } },
      ],
    });
    service = TestBed.inject(PublicShareService);
    crypto = TestBed.inject(CryptoService);
  });

  it('seals the conversation secret to the share key and the share key to the conversation', async () => {
    const conversation = buildConversation(crypto);

    const url = await firstValueFrom(service.share(conversation));
    expect(url).toContain('/p/tok123#');
    const request = api.lastCreateRequest;
    expect(request).not.toBeNull();

    // The URL fragment carries the public-share secret key. Re-derive the
    // keypair and confirm it opens the wrapped conversation secret back to
    // the original conversation secret key — the anonymous-reader path.
    const fragmentSecret = Base64.toUint8Array(fragmentOf(url));
    const publicShareKeyPair = crypto.keyPairFromSecretKey(fragmentSecret);
    const recoveredConvSecret = crypto.openSealedBox(
      Base64.toUint8Array(request!.wrapped_conversation_secret_key),
      publicShareKeyPair,
    );
    expect(Array.from(recoveredConvSecret)).toEqual(
      Array.from(conversation.keyPair.secretKey),
    );

    // The conversation keypair opens share_secret back to the fragment secret
    // — the participant-recovery path.
    const recoveredShareSecret = crypto.openSealedBox(
      Base64.toUint8Array(request!.share_secret),
      conversation.keyPair,
    );
    expect(Array.from(recoveredShareSecret)).toEqual(Array.from(fragmentSecret));
  });

  it('rebuilds the identical link from an existing share_secret', async () => {
    const conversation = buildConversation(crypto);
    const publicShareKeyPair = crypto.newKeyPair();
    const shareSecret = crypto.createSealedBox(
      publicShareKeyPair.secretKey,
      conversation.keyPair.publicKey,
    );
    api.getResponse = {
      token: 'tok999',
      public_key: Base64.fromUint8Array(publicShareKeyPair.publicKey),
      share_secret: Base64.fromUint8Array(shareSecret),
      key_version: 1,
      mode: 'redacted_only',
    };

    const url = await firstValueFrom(service.existingShareUrl(conversation));
    expect(url).not.toBeNull();
    expect(url).toContain('/p/tok999#');
    const fragmentSecret = Base64.toUint8Array(fragmentOf(url!));
    expect(Array.from(fragmentSecret)).toEqual(
      Array.from(publicShareKeyPair.secretKey),
    );
  });

  it('revoke deletes the share for the conversation', async () => {
    const conversation = buildConversation(crypto);

    await firstValueFrom(service.revoke(conversation));
    expect(api.deletedConversationId).toBe(conversation.record.id);
  });

  it('returns null when the conversation is not shared (404)', async () => {
    const conversation = buildConversation(crypto);
    api.getResponse = { status: 404 };

    const url = await firstValueFrom(service.existingShareUrl(conversation));
    expect(url).toBeNull();
  });

  it('propagates non-404 errors', async () => {
    const conversation = buildConversation(crypto);
    api.getResponse = { status: 500 };

    await expect(
      firstValueFrom(service.existingShareUrl(conversation)),
    ).rejects.toMatchObject({ status: 500 });
  });
});
