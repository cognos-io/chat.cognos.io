import { expect, test } from '@playwright/test';

import { provisionApiUser } from './api-helpers';

// Conversation data is base64-encoded ciphertext in production; the API
// doesn't enforce the inner shape, so a constant placeholder works for the
// access-control behaviour we're proving here.
const CONVERSATION_DATA_B64 = Buffer.from(
  JSON.stringify({ title: 'E2E participants suite' }),
).toString('base64');

// Wrapped secret keys are likewise opaque ciphertext from the API's
// perspective. Any non-empty string survives the round-trip — these tests
// pin behaviour, not crypto correctness (the backend integration tests
// cover the JSON-then-NaCl envelope separately). Repeated character runs
// stay below gitleaks' entropy threshold while still being identifiable in
// failure output.
const WRAPPED_SECRET_FOR_ADMIN = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const WRAPPED_SECRET_FOR_GUEST = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';
const ROTATED_WRAPPED_FOR_ADMIN = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=';
const ROTATED_WRAPPED_FOR_GUEST = 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD=';
const ROTATED_CONVERSATION_PUBKEY = 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE=';

test.describe('participants + rotation API', () => {
  test('admin can list, add, revoke participants and rotate the conversation key', async () => {
    const admin = await provisionApiUser();
    const guest = await provisionApiUser();
    try {
      // 1. Admin creates a conversation. The backend auto-seeds an Admin
      //    participant row for the creator, so a GET right after must
      //    show exactly one member (the creator).
      const createConv = await admin.api.post('/api/v1/conversations', {
        data: { data: CONVERSATION_DATA_B64, expiry_duration: '' },
      });
      expect(
        createConv.ok(),
        `create conv: ${createConv.status()} ${await createConv.text()}`,
      ).toBe(true);
      const conversation = (await createConv.json()) as {
        id: string;
        key_version: number;
      };
      expect(conversation.id).toBeTruthy();
      expect(conversation.key_version).toBe(1);

      const initialList = await admin.api.get(
        `/api/v1/conversations/${conversation.id}/participants`,
      );
      expect(initialList.ok()).toBe(true);
      const initialBody = (await initialList.json()) as {
        participants: { user_id: string; role: string }[];
      };
      expect(initialBody.participants).toHaveLength(1);
      expect(initialBody.participants[0]).toMatchObject({
        user_id: admin.userId,
        role: 'Admin',
      });

      // 2. Before sharing, the guest must not see the conversation in
      //    their list — confirms the participant access gate from the
      //    other side.
      const guestPreList = await guest.api.get('/api/v1/conversations');
      expect(guestPreList.ok()).toBe(true);
      const guestPreBody = (await guestPreList.json()) as { id: string }[];
      expect(guestPreBody.some((c) => c.id === conversation.id)).toBe(false);

      const guestPreParticipants = await guest.api.get(
        `/api/v1/conversations/${conversation.id}/participants`,
      );
      expect(guestPreParticipants.status()).toBe(404);

      // 3. Admin shares: adds the guest as an Editor in one transactional
      //    call (participant row + wrapped secret-key row).
      const addRes = await admin.api.post(
        `/api/v1/conversations/${conversation.id}/participants`,
        {
          data: {
            user_id: guest.userId,
            role: 'Editor',
            wrapped_secret_key: WRAPPED_SECRET_FOR_GUEST,
          },
        },
      );
      expect(addRes.ok(), `add: ${addRes.status()} ${await addRes.text()}`).toBe(true);
      const added = (await addRes.json()) as { user_id: string; role: string };
      expect(added).toMatchObject({ user_id: guest.userId, role: 'Editor' });

      // 4. Post-add: the guest must now see the conversation in their
      //    list, and the participants list must show both members.
      const guestList = await guest.api.get('/api/v1/conversations');
      expect(guestList.ok()).toBe(true);
      const guestBody = (await guestList.json()) as {
        id: string;
        key_version: number;
      }[];
      expect(guestBody.find((c) => c.id === conversation.id)).toMatchObject({
        key_version: 1,
      });

      const participantsAfterAdd = await admin.api.get(
        `/api/v1/conversations/${conversation.id}/participants`,
      );
      const participantsAfterAddBody = (await participantsAfterAdd.json()) as {
        participants: { user_id: string; role: string }[];
      };
      expect(participantsAfterAddBody.participants).toHaveLength(2);
      const roleByUser = Object.fromEntries(
        participantsAfterAddBody.participants.map((p) => [p.user_id, p.role]),
      );
      expect(roleByUser[admin.userId]).toBe('Admin');
      expect(roleByUser[guest.userId]).toBe('Editor');

      // 5. Editors must not be able to add or revoke participants — the
      //    role-based gate is the security boundary that lets us trust the
      //    list/secret-key contract.
      const editorAdd = await guest.api.post(
        `/api/v1/conversations/${conversation.id}/participants`,
        {
          data: {
            user_id: admin.userId,
            role: 'Viewer',
            wrapped_secret_key: WRAPPED_SECRET_FOR_ADMIN,
          },
        },
      );
      expect(editorAdd.status()).toBe(403);

      const editorRevoke = await guest.api.delete(
        `/api/v1/conversations/${conversation.id}/participants/${admin.userId}`,
      );
      expect(editorRevoke.status()).toBe(403);

      // 6. Admin rotates the conversation key. Payload must cover every
      //    active participant — both admin and guest still active here.
      const rotateRes = await admin.api.post(
        `/api/v1/conversations/${conversation.id}/rotate`,
        {
          data: {
            public_key: ROTATED_CONVERSATION_PUBKEY,
            wrapped_secret_keys: [
              { user_id: admin.userId, secret_key: ROTATED_WRAPPED_FOR_ADMIN },
              { user_id: guest.userId, secret_key: ROTATED_WRAPPED_FOR_GUEST },
            ],
          },
        },
      );
      expect(
        rotateRes.ok(),
        `rotate: ${rotateRes.status()} ${await rotateRes.text()}`,
      ).toBe(true);
      const rotated = (await rotateRes.json()) as { key_version: number };
      expect(rotated.key_version).toBe(2);

      // After rotation: the guest's secret-key GET surfaces the NEW
      // wrapped value at the new generation. The old v1 row stays in the
      // DB as audit data but the read filter never exposes it.
      const guestSecretKey = await guest.api.get(
        `/api/v1/conversations/${conversation.id}/secret-key`,
      );
      expect(guestSecretKey.ok()).toBe(true);
      const guestSecretKeyBody = (await guestSecretKey.json()) as {
        secret_key: string;
        key_version: number;
      };
      expect(guestSecretKeyBody.key_version).toBe(2);
      expect(guestSecretKeyBody.secret_key).toBe(ROTATED_WRAPPED_FOR_GUEST);

      // The conversation row itself now reports the new generation.
      const conversationsAfterRotate = await admin.api.get('/api/v1/conversations');
      const convAfterRotateBody = (await conversationsAfterRotate.json()) as {
        id: string;
        key_version: number;
      }[];
      expect(
        convAfterRotateBody.find((c) => c.id === conversation.id)?.key_version,
      ).toBe(2);

      // 7. Rotation that misses a participant must be rejected — the
      //    integration test pins this at the unit level, but exercising it
      //    here against a live PocketBase proves the JSON-validation
      //    boundary catches a real attacker who tries to drop a
      //    participant by omission.
      const rotateMissing = await admin.api.post(
        `/api/v1/conversations/${conversation.id}/rotate`,
        {
          data: {
            public_key: ROTATED_CONVERSATION_PUBKEY,
            wrapped_secret_keys: [
              { user_id: admin.userId, secret_key: ROTATED_WRAPPED_FOR_ADMIN },
            ],
          },
        },
      );
      expect(rotateMissing.status()).toBe(400);

      // 8. Admin revokes the guest. The audit row stays in the DB but the
      //    guest's list/access endpoints must stop returning the
      //    conversation.
      const revokeRes = await admin.api.delete(
        `/api/v1/conversations/${conversation.id}/participants/${guest.userId}`,
      );
      expect(
        revokeRes.ok(),
        `revoke: ${revokeRes.status()} ${await revokeRes.text()}`,
      ).toBe(true);

      const guestPostRevoke = await guest.api.get('/api/v1/conversations');
      const guestPostRevokeBody = (await guestPostRevoke.json()) as { id: string }[];
      expect(guestPostRevokeBody.some((c) => c.id === conversation.id)).toBe(false);

      const adminPostRevoke = await admin.api.get(
        `/api/v1/conversations/${conversation.id}/participants`,
      );
      const adminPostRevokeBody = (await adminPostRevoke.json()) as {
        participants: { user_id: string }[];
      };
      expect(adminPostRevokeBody.participants).toHaveLength(1);
      expect(adminPostRevokeBody.participants[0].user_id).toBe(admin.userId);

      // 9. Self-revoke is intentionally blocked — would orphan the
      //    conversation without explicit Admin-transfer.
      const selfRevoke = await admin.api.delete(
        `/api/v1/conversations/${conversation.id}/participants/${admin.userId}`,
      );
      expect(selfRevoke.status()).toBe(400);
    } finally {
      await admin.api.dispose();
      await guest.api.dispose();
    }
  });

  test('outside users cannot reach a conversation they were never added to', async () => {
    const owner = await provisionApiUser();
    const stranger = await provisionApiUser();
    try {
      const createConv = await owner.api.post('/api/v1/conversations', {
        data: { data: CONVERSATION_DATA_B64, expiry_duration: '' },
      });
      expect(createConv.ok()).toBe(true);
      const conversation = (await createConv.json()) as { id: string };

      // Same shape as a "conversation does not exist" — proving the
      // endpoint doesn't leak the existence of the id to non-participants.
      const list = await stranger.api.get(
        `/api/v1/conversations/${conversation.id}/participants`,
      );
      expect(list.status()).toBe(404);

      const tryAdd = await stranger.api.post(
        `/api/v1/conversations/${conversation.id}/participants`,
        {
          data: {
            user_id: stranger.userId,
            role: 'Editor',
            wrapped_secret_key: WRAPPED_SECRET_FOR_GUEST,
          },
        },
      );
      // Outsiders hit the conversation-access gate before any role check,
      // so the response shape is the same 404 the GET returned above.
      expect(tryAdd.status()).toBe(404);

      const tryRotate = await stranger.api.post(
        `/api/v1/conversations/${conversation.id}/rotate`,
        {
          data: {
            public_key: ROTATED_CONVERSATION_PUBKEY,
            wrapped_secret_keys: [
              { user_id: owner.userId, secret_key: ROTATED_WRAPPED_FOR_ADMIN },
            ],
          },
        },
      );
      expect(tryRotate.status()).toBe(404);
    } finally {
      await owner.api.dispose();
      await stranger.api.dispose();
    }
  });
});
