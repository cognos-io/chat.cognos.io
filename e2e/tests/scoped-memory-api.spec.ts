import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { newAnonymousApi, provisionApiUser } from './api-helpers';

const b64 = (s: string) => Buffer.from(s).toString('base64');

interface MemoryRecord {
  id: string;
  data: string;
}
interface MemoryList {
  items: MemoryRecord[];
}

test.describe('user memory API', () => {
  test('owner can create/list/update/delete; another user cannot see or touch it', async () => {
    const owner = await provisionApiUser();
    const other = await provisionApiUser();
    try {
      const createRes = await owner.api.post('/api/v1/user-memory', {
        data: { data: b64('user-memory-v1') },
      });
      expect(
        createRes.ok(),
        `create: ${createRes.status()} ${await createRes.text()}`,
      ).toBe(true);
      const created = (await createRes.json()) as MemoryRecord;
      expect(created.id).toBeTruthy();
      expect(created.data).toBe(b64('user-memory-v1'));

      // Owner sees it; the other user's list is scoped to themselves.
      const ownerList = (await (
        await owner.api.get('/api/v1/user-memory')
      ).json()) as MemoryList;
      expect(ownerList.items.map((i) => i.id)).toContain(created.id);
      const otherList = (await (
        await other.api.get('/api/v1/user-memory')
      ).json()) as MemoryList;
      expect(otherList.items.map((i) => i.id)).not.toContain(created.id);

      // The other user cannot update or delete it.
      expect(
        (
          await other.api.patch(`/api/v1/user-memory/${created.id}`, {
            data: { data: b64('hijacked') },
          })
        ).status(),
      ).toBe(404);
      expect(
        (await other.api.delete(`/api/v1/user-memory/${created.id}`)).status(),
      ).toBe(404);

      // Owner updates then deletes.
      const patchRes = await owner.api.patch(`/api/v1/user-memory/${created.id}`, {
        data: { data: b64('user-memory-v2') },
      });
      expect(patchRes.ok()).toBe(true);
      expect(((await patchRes.json()) as MemoryRecord).data).toBe(
        b64('user-memory-v2'),
      );

      expect(
        (await owner.api.delete(`/api/v1/user-memory/${created.id}`)).status(),
      ).toBe(204);
      const after = (await (
        await owner.api.get('/api/v1/user-memory')
      ).json()) as MemoryList;
      expect(after.items.map((i) => i.id)).not.toContain(created.id);
    } finally {
      await owner.api.dispose();
      await other.api.dispose();
    }
  });

  test('unauthenticated callers are rejected', async () => {
    const api = await newAnonymousApi();
    try {
      expect((await api.get('/api/v1/user-memory')).status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });
});

test.describe('project memory API', () => {
  async function createProject(user: Awaited<ReturnType<typeof provisionApiUser>>) {
    const res = await user.api.post('/api/v1/projects', {
      data: {
        data: b64(JSON.stringify({ name: 'Memory project' })),
        wrapped_project_key: randomBytes(48).toString('base64'),
      },
    });
    expect(res.ok(), `project: ${res.status()} ${await res.text()}`).toBe(true);
    return ((await res.json()) as { id: string }).id;
  }

  test('members can create/list/update/delete; non-members get 404', async () => {
    const owner = await provisionApiUser();
    const outsider = await provisionApiUser();
    try {
      const projectID = await createProject(owner);

      const createRes = await owner.api.post(`/api/v1/projects/${projectID}/memory`, {
        data: { data: b64('project-memory-v1') },
      });
      expect(
        createRes.ok(),
        `create: ${createRes.status()} ${await createRes.text()}`,
      ).toBe(true);
      const created = (await createRes.json()) as MemoryRecord;
      expect(created.data).toBe(b64('project-memory-v1'));

      const list = (await (
        await owner.api.get(`/api/v1/projects/${projectID}/memory`)
      ).json()) as MemoryList;
      expect(list.items.map((i) => i.id)).toContain(created.id);

      // Non-member is walled off at every verb (404, never a leak).
      expect(
        (await outsider.api.get(`/api/v1/projects/${projectID}/memory`)).status(),
      ).toBe(404);
      expect(
        (
          await outsider.api.post(`/api/v1/projects/${projectID}/memory`, {
            data: { data: b64('sneak') },
          })
        ).status(),
      ).toBe(404);
      expect(
        (
          await outsider.api.patch(`/api/v1/project-memory/${created.id}`, {
            data: { data: b64('sneak') },
          })
        ).status(),
      ).toBe(404);
      expect(
        (await outsider.api.delete(`/api/v1/project-memory/${created.id}`)).status(),
      ).toBe(404);

      // Member can update + delete.
      const patchRes = await owner.api.patch(`/api/v1/project-memory/${created.id}`, {
        data: { data: b64('project-memory-v2') },
      });
      expect(patchRes.ok()).toBe(true);
      expect(
        (await owner.api.delete(`/api/v1/project-memory/${created.id}`)).status(),
      ).toBe(204);
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });
});
