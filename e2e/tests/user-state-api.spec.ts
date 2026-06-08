import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { newAnonymousApi, provisionApiUser } from './api-helpers';

interface UserKeyPairResponse {
  id: string;
  public_key: string;
  secret_key: string;
  password_salt?: string;
  record_mac?: string;
  unlock_scheme?: string;
  user: string;
}

interface UserPreferencesResponse {
  id: string;
  data: string;
  user: string;
}

interface VaultSessionResponse {
  wrap_key: string;
}

// All key/secret payloads are ciphertext as far as the API is concerned —
// the crypto correctness is verified by backend unit tests. Random bytes
// in placeholder shapes are sufficient to exercise the request/response
// contract.
function randomBase64(bytes: number): string {
  return randomBytes(bytes).toString('base64');
}

const VALID_USER_KEY_PAIR_BODY = () => ({
  public_key: randomBase64(32),
  secret_key: randomBase64(64),
  password_salt: randomBase64(16),
  unlock_scheme: 'password_account_key_v1',
  record_mac: randomBase64(32),
});

// 32 bytes encoded → exactly 44 base64 chars (incl. one `=` pad). The
// vault-session handler hardcodes this length as a structural check.
const VALID_WRAP_KEY = randomBase64(32);

test.describe('user key pair API', () => {
  test('auth gate fires on every user-key-pair route', async () => {
    const api = await newAnonymousApi();
    try {
      expect((await api.get('/api/v1/user-key-pair')).status()).toBe(401);
      expect(
        (
          await api.post('/api/v1/user-key-pair', { data: VALID_USER_KEY_PAIR_BODY() })
        ).status(),
      ).toBe(401);
      expect(
        (
          await api.patch('/api/v1/user-key-pair/anykeypairid000', {
            data: { record_mac: randomBase64(32) },
          })
        ).status(),
      ).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('GET before create returns 404', async () => {
    // A fresh user has no key pair until the unlock-key dance runs.
    // The shape must be a clean 404, not 500 or 200-with-empty-body.
    const user = await provisionApiUser();
    try {
      const res = await user.api.get('/api/v1/user-key-pair');
      expect(res.status()).toBe(404);
    } finally {
      await user.api.dispose();
    }
  });

  test('POST creates a key pair and a follow-up GET returns it', async () => {
    const user = await provisionApiUser();
    try {
      const body = VALID_USER_KEY_PAIR_BODY();
      const create = await user.api.post('/api/v1/user-key-pair', { data: body });
      expect(create.status()).toBe(201);
      const created = (await create.json()) as UserKeyPairResponse;
      expect(created.public_key).toBe(body.public_key);
      expect(created.secret_key).toBe(body.secret_key);
      expect(created.user).toBe(user.userId);

      const fetch = await user.api.get('/api/v1/user-key-pair');
      expect(fetch.ok()).toBe(true);
      const fetched = (await fetch.json()) as UserKeyPairResponse;
      expect(fetched.id).toBe(created.id);
      expect(fetched.public_key).toBe(body.public_key);
    } finally {
      await user.api.dispose();
    }
  });

  test('POST rejects missing public_key + secret_key fields', async () => {
    const user = await provisionApiUser();
    try {
      const res = await user.api.post('/api/v1/user-key-pair', { data: {} });
      expect(res.status()).toBe(400);
    } finally {
      await user.api.dispose();
    }
  });

  test('PATCH /user-key-pair/{id} can update the record_mac for the owner', async () => {
    const user = await provisionApiUser();
    try {
      const create = await user.api.post('/api/v1/user-key-pair', {
        data: VALID_USER_KEY_PAIR_BODY(),
      });
      expect(create.ok()).toBe(true);
      const { id, public_key } = (await create.json()) as UserKeyPairResponse;

      const newMac = randomBase64(32);
      const patch = await user.api.patch(`/api/v1/user-key-pair/${id}`, {
        data: { record_mac: newMac },
      });
      expect(patch.ok(), `patch: ${patch.status()} ${await patch.text()}`).toBe(true);

      const fetch = await user.api.get('/api/v1/user-key-pair');
      const fetched = (await fetch.json()) as UserKeyPairResponse;
      expect(fetched.record_mac).toBe(newMac);
      // Public key must NOT have been mutated by a record_mac PATCH —
      // confirms the update is scoped to the documented field.
      expect(fetched.public_key).toBe(public_key);
    } finally {
      await user.api.dispose();
    }
  });

  test("PATCH on another user's key pair id is rejected", async () => {
    const owner = await provisionApiUser();
    const outsider = await provisionApiUser();
    try {
      const create = await owner.api.post('/api/v1/user-key-pair', {
        data: VALID_USER_KEY_PAIR_BODY(),
      });
      const { id } = (await create.json()) as UserKeyPairResponse;

      const attack = await outsider.api.patch(`/api/v1/user-key-pair/${id}`, {
        data: { record_mac: randomBase64(32) },
      });
      // Either 403 or 404 is fine; the contract is "outsider cannot
      // mutate" so we require a non-2xx status. Locking only "not 2xx"
      // keeps the test independent of whether the handler currently
      // chooses to leak existence (it shouldn't).
      expect(attack.ok()).toBe(false);
      expect(attack.status()).toBeGreaterThanOrEqual(400);
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });
});

test.describe('user preferences API', () => {
  test('auth gate fires on every preferences route', async () => {
    const api = await newAnonymousApi();
    try {
      expect((await api.get('/api/v1/user-preferences')).status()).toBe(401);
      expect(
        (
          await api.post('/api/v1/user-preferences', {
            data: { data: randomBase64(8) },
          })
        ).status(),
      ).toBe(401);
      expect(
        (
          await api.patch('/api/v1/user-preferences/anyprefid000000', {
            data: { data: randomBase64(8) },
          })
        ).status(),
      ).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('GET before create returns 404', async () => {
    const user = await provisionApiUser();
    try {
      const res = await user.api.get('/api/v1/user-preferences');
      expect(res.status()).toBe(404);
    } finally {
      await user.api.dispose();
    }
  });

  test('POST + GET + PATCH round-trips encrypted preferences', async () => {
    const user = await provisionApiUser();
    try {
      const initialBody = { data: randomBase64(24) };
      const create = await user.api.post('/api/v1/user-preferences', {
        data: initialBody,
      });
      expect(create.status()).toBe(201);
      const created = (await create.json()) as UserPreferencesResponse;
      expect(created.data).toBe(initialBody.data);
      expect(created.user).toBe(user.userId);

      const fetch = await user.api.get('/api/v1/user-preferences');
      expect(fetch.ok()).toBe(true);
      const fetched = (await fetch.json()) as UserPreferencesResponse;
      expect(fetched.id).toBe(created.id);
      expect(fetched.data).toBe(initialBody.data);

      const updatedBody = { data: randomBase64(24) };
      const patch = await user.api.patch(`/api/v1/user-preferences/${created.id}`, {
        data: updatedBody,
      });
      expect(patch.ok()).toBe(true);
      const patched = (await patch.json()) as UserPreferencesResponse;
      expect(patched.data).toBe(updatedBody.data);
    } finally {
      await user.api.dispose();
    }
  });

  test('POST rejects an empty data field', async () => {
    const user = await provisionApiUser();
    try {
      const res = await user.api.post('/api/v1/user-preferences', {
        data: { data: '' },
      });
      expect(res.status()).toBe(400);
    } finally {
      await user.api.dispose();
    }
  });

  test("PATCH on another user's preferences id is rejected", async () => {
    const owner = await provisionApiUser();
    const outsider = await provisionApiUser();
    try {
      const create = await owner.api.post('/api/v1/user-preferences', {
        data: { data: randomBase64(24) },
      });
      const { id } = (await create.json()) as UserPreferencesResponse;

      const attack = await outsider.api.patch(`/api/v1/user-preferences/${id}`, {
        data: { data: randomBase64(24) },
      });
      expect(attack.ok()).toBe(false);
      expect(attack.status()).toBeGreaterThanOrEqual(400);
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });
});

test.describe('vault session API', () => {
  test('auth gate fires on every vault-session route', async () => {
    const api = await newAnonymousApi();
    try {
      expect((await api.get('/api/v1/vault-session')).status()).toBe(401);
      expect(
        (
          await api.put('/api/v1/vault-session', { data: { wrap_key: VALID_WRAP_KEY } })
        ).status(),
      ).toBe(401);
      expect((await api.delete('/api/v1/vault-session')).status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('GET before upsert returns 404', async () => {
    const user = await provisionApiUser();
    try {
      const res = await user.api.get('/api/v1/vault-session');
      expect(res.status()).toBe(404);
    } finally {
      await user.api.dispose();
    }
  });

  test('PUT upserts the wrap key and GET returns it; second PUT overwrites', async () => {
    const user = await provisionApiUser();
    try {
      const first = randomBase64(32);
      const put1 = await user.api.put('/api/v1/vault-session', {
        data: { wrap_key: first },
      });
      expect(put1.ok(), `put1: ${put1.status()} ${await put1.text()}`).toBe(true);

      const get1 = await user.api.get('/api/v1/vault-session');
      expect(get1.ok()).toBe(true);
      expect(((await get1.json()) as VaultSessionResponse).wrap_key).toBe(first);

      // The PUT is documented as an upsert — a second PUT with a fresh
      // wrap key must overwrite without throwing on the unique (user)
      // index. Pin that contract end-to-end.
      const second = randomBase64(32);
      const put2 = await user.api.put('/api/v1/vault-session', {
        data: { wrap_key: second },
      });
      expect(put2.ok()).toBe(true);

      const get2 = await user.api.get('/api/v1/vault-session');
      expect(((await get2.json()) as VaultSessionResponse).wrap_key).toBe(second);
    } finally {
      await user.api.dispose();
    }
  });

  test('PUT rejects wrap_key that is not exactly 44 base64 chars (32 bytes)', async () => {
    const user = await provisionApiUser();
    try {
      for (const badKey of ['', 'short', randomBase64(16), randomBase64(64)]) {
        const res = await user.api.put('/api/v1/vault-session', {
          data: { wrap_key: badKey },
        });
        expect(res.status(), `wrap_key length=${badKey.length} expected 400`).toBe(400);
      }
    } finally {
      await user.api.dispose();
    }
  });

  test('DELETE removes the wrap key and a follow-up GET 404s', async () => {
    const user = await provisionApiUser();
    try {
      await user.api.put('/api/v1/vault-session', {
        data: { wrap_key: VALID_WRAP_KEY },
      });

      const del = await user.api.delete('/api/v1/vault-session');
      expect(del.ok()).toBe(true);

      const get = await user.api.get('/api/v1/vault-session');
      expect(get.status()).toBe(404);
    } finally {
      await user.api.dispose();
    }
  });

  test("vault session is per-user — user B cannot read user A's wrap key", async () => {
    const userA = await provisionApiUser();
    const userB = await provisionApiUser();
    try {
      const wrapKeyA = randomBase64(32);
      const putA = await userA.api.put('/api/v1/vault-session', {
        data: { wrap_key: wrapKeyA },
      });
      expect(putA.ok()).toBe(true);

      const getB = await userB.api.get('/api/v1/vault-session');
      // user B has never set one — must 404 regardless of whether
      // anyone else has. Pin that the lookup is strictly per-user.
      expect(getB.status()).toBe(404);
    } finally {
      await userA.api.dispose();
      await userB.api.dispose();
    }
  });
});
