import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';

import { AuthService } from '@app/services/auth.service';
import {
  ApiConversationImportRequest,
  CognosApiService,
} from '@app/services/cognos-api.service';
import { ConversationService } from '@app/services/conversation.service';
import { CryptoService } from '@app/services/crypto.service';

import { ConversationImportPersistence } from './conversation-import-persistence';

describe('ConversationImportPersistence', () => {
  let service: ConversationImportPersistence;
  let request: ApiConversationImportRequest | undefined;
  const sealedPayloads: Record<string, unknown>[] = [];
  const cryptoService = {
    newKeyPair: () => ({
      publicKey: new Uint8Array(32).fill(1),
      secretKey: new Uint8Array(32).fill(2),
    }),
    createSealedBox: (plaintext: Uint8Array) => {
      sealedPayloads.push(JSON.parse(new TextDecoder().decode(plaintext)));
      return new Uint8Array(64).fill(sealedPayloads.length);
    },
  };

  beforeEach(() => {
    request = undefined;
    sealedPayloads.length = 0;
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { user: () => ({ id: 'account-a' }) } },
        { provide: CryptoService, useValue: cryptoService },
        {
          provide: ConversationService,
          useValue: {
            buildNewConversationKeyMaterial: () => ({
              data: 'encrypted-title',
              public_key: 'public-key',
              public_key_signature: 'signature',
              wrapped_secret_key: 'wrapped-secret',
            }),
            upsertConversations: vi.fn(),
          },
        },
        {
          provide: CognosApiService,
          useValue: {
            importConversation: (value: ApiConversationImportRequest) => {
              request = value;
              return of({
                conversation: {
                  id: value.conversation.id,
                  data: value.conversation.data,
                  creator: 'account-a',
                  created: '2026-01-01T00:00:00Z',
                  updated: '2026-01-01T00:00:00Z',
                  last_activity_at: '2026-01-01T00:00:00Z',
                  expiry_duration: '',
                  key_version: 1,
                },
                message_count: value.messages.length,
              });
            },
          },
        },
      ],
    });
    service = TestBed.inject(ConversationImportPersistence);
  });

  it('seals content and preserves encrypted parent bindings', async () => {
    const marker = 'PRIVATE-IMPORT-MARKER-65aef29c';
    const conversation = await service.persist('claude', {
      sourceId: 'source',
      title: 'Synthetic title',
      messages: [
        { sourceId: 'one', parentSourceId: null, role: 'user', text: marker },
        {
          sourceId: 'two',
          parentSourceId: 'one',
          role: 'assistant',
          text: 'Synthetic answer',
        },
      ],
      warnings: {
        attachments: 0,
        images: 0,
        tools: 0,
        unsupported: 0,
        ambiguousBranches: 0,
      },
    });

    expect(JSON.stringify(request)).not.toContain(marker);
    expect(request?.messages[1].parent_message).toBe(request?.messages[0].id);
    expect(conversation.keyPair.publicKey).toEqual(new Uint8Array(32).fill(1));
    expect(sealedPayloads.map((message) => message['content'])).toEqual([
      marker,
      'Synthetic answer',
    ]);
    expect(sealedPayloads[0]['owner_id']).toBe('account-a');
    expect(sealedPayloads[1]['owner_id']).toBeUndefined();
  });
});
