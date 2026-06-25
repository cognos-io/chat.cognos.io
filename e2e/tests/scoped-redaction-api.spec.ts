import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { provisionApiUser } from './api-helpers';

const b64 = (s: string) => Buffer.from(s).toString('base64');
const TOKEN = '[[PII_EMAIL_ABC123]]';

interface EntriesList {
  items: { token: string; data: string }[];
}

test.describe('user redaction entries API', () => {
  test('owner can create + list; another user cannot see them', async () => {
    const owner = await provisionApiUser();
    const other = await provisionApiUser();
    try {
      const res = await owner.api.post('/api/v1/user-redaction-entries', {
        data: { entries: [{ token: TOKEN, data: b64('sealed-original') }] },
      });
      expect(res.ok(), `create: ${res.status()} ${await res.text()}`).toBe(true);
      expect(((await res.json()) as { created: string[] }).created).toContain(TOKEN);

      const list = (await (
        await owner.api.get('/api/v1/user-redaction-entries')
      ).json()) as EntriesList;
      expect(list.items.map((i) => i.token)).toContain(TOKEN);

      const otherList = (await (
        await other.api.get('/api/v1/user-redaction-entries')
      ).json()) as EntriesList;
      expect(otherList.items.map((i) => i.token)).not.toContain(TOKEN);
    } finally {
      await owner.api.dispose();
      await other.api.dispose();
    }
  });
});

test.describe('project redaction key + entries API', () => {
  async function createProject(user: Awaited<ReturnType<typeof provisionApiUser>>) {
    const res = await user.api.post('/api/v1/projects', {
      data: {
        data: b64(JSON.stringify({ name: 'Redaction project' })),
        wrapped_project_key: randomBytes(48).toString('base64'),
      },
    });
    expect(res.ok(), `project: ${res.status()} ${await res.text()}`).toBe(true);
    return ((await res.json()) as { id: string }).id;
  }

  test('member can create the keypair (once) + entries; non-member is walled off', async () => {
    const owner = await provisionApiUser();
    const outsider = await provisionApiUser();
    try {
      const projectID = await createProject(owner);

      // Create the per-member project redaction key.
      const keyRes = await owner.api.post(
        `/api/v1/projects/${projectID}/redaction-key`,
        {
          data: {
            public_key: randomBytes(32).toString('base64'),
            keys: [
              {
                user_id: owner.userId,
                wrapped_secret_key: randomBytes(48).toString('base64'),
              },
            ],
          },
        },
      );
      expect(keyRes.status(), `key: ${keyRes.status()} ${await keyRes.text()}`).toBe(
        201,
      );

      // Create-once per generation.
      const dupe = await owner.api.post(`/api/v1/projects/${projectID}/redaction-key`, {
        data: {
          public_key: randomBytes(32).toString('base64'),
          keys: [
            {
              user_id: owner.userId,
              wrapped_secret_key: randomBytes(48).toString('base64'),
            },
          ],
        },
      });
      expect(dupe.status()).toBe(409);

      // Caller fetches their wrapped key.
      const getKey = await owner.api.get(`/api/v1/projects/${projectID}/redaction-key`);
      expect(getKey.ok()).toBe(true);
      expect(((await getKey.json()) as { public_key: string }).public_key).toBeTruthy();

      // Entries round-trip for the member.
      const entryRes = await owner.api.post(
        `/api/v1/projects/${projectID}/redaction-entries`,
        { data: { entries: [{ token: TOKEN, data: b64('sealed-original') }] } },
      );
      expect(entryRes.status()).toBe(201);
      const list = (await (
        await owner.api.get(`/api/v1/projects/${projectID}/redaction-entries`)
      ).json()) as EntriesList;
      expect(list.items.map((i) => i.token)).toContain(TOKEN);

      // Non-member gets 404 everywhere (never a leak).
      expect(
        (
          await outsider.api.get(`/api/v1/projects/${projectID}/redaction-key`)
        ).status(),
      ).toBe(404);
      expect(
        (
          await outsider.api.get(`/api/v1/projects/${projectID}/redaction-entries`)
        ).status(),
      ).toBe(404);
      expect(
        (
          await outsider.api.post(`/api/v1/projects/${projectID}/redaction-entries`, {
            data: { entries: [{ token: TOKEN, data: b64('x') }] },
          })
        ).status(),
      ).toBe(404);
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });

  test('a wrapped key targeting a non-member is rejected', async () => {
    const owner = await provisionApiUser();
    const stranger = await provisionApiUser();
    try {
      const projectID = await createProject(owner);
      const res = await owner.api.post(`/api/v1/projects/${projectID}/redaction-key`, {
        data: {
          public_key: randomBytes(32).toString('base64'),
          keys: [
            {
              user_id: stranger.userId,
              wrapped_secret_key: randomBytes(48).toString('base64'),
            },
          ],
        },
      });
      expect(res.status()).toBe(400);
    } finally {
      await owner.api.dispose();
      await stranger.api.dispose();
    }
  });
});
