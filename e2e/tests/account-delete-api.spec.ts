import { APIRequestContext, expect, request, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import {
  POCKETBASE_URL,
  type ProvisionedApiUser,
  newAnonymousApi,
  provisionApiUser,
} from './api-helpers';
import { upsertOrgBilling } from './persona-helpers';

// OP-001 regression: Account deletion must never wipe Organisation content,
// must 409 for Owners, and must offboard ordinary members (revoke access +
// mark Project key rotation pending) before erasing personal data.

const API_CONTEXT_OPTIONS = {
  baseURL: POCKETBASE_URL,
  ignoreHTTPSErrors: true,
};

const SUPERUSER_EMAIL = process.env.E2E_SUPERUSER_EMAIL ?? 'e2e-superuser@example.com';
const SUPERUSER_PASSWORD =
  process.env.E2E_SUPERUSER_PASSWORD ?? 'e2e-superuser-password-1234'; // gitleaks:allow

function randomBase64(bytes: number): string {
  return randomBytes(bytes).toString('base64');
}

async function deleteAccount(
  user: ProvisionedApiUser,
): Promise<Awaited<ReturnType<APIRequestContext['delete']>>> {
  return user.api.delete('/api/v1/account', {
    data: { password: user.account.password },
    headers: { 'content-type': 'application/json' },
  });
}

async function inviteAndAccept(
  owner: ProvisionedApiUser,
  member: ProvisionedApiUser,
  orgId: string,
): Promise<void> {
  const inviteRes = await owner.api.post(`/api/v1/orgs/${orgId}/invites`, {
    data: { email: member.account.email, role: 'member' },
  });
  expect(
    inviteRes.ok(),
    `invite: ${inviteRes.status()} ${await inviteRes.text()}`,
  ).toBe(true);
  const { token } = (await inviteRes.json()) as { token: string };

  const acceptRes = await member.api.post('/api/v1/org-invites/accept', {
    data: { token },
  });
  expect(
    acceptRes.ok(),
    `accept invite: ${acceptRes.status()} ${await acceptRes.text()}`,
  ).toBe(true);
}

async function createOrgProject(
  creator: ProvisionedApiUser,
  orgId: string,
): Promise<string> {
  const res = await creator.api.post('/api/v1/projects', {
    data: {
      data: randomBase64(48),
      wrapped_project_key: randomBase64(48),
      organisation: orgId,
    },
  });
  expect(res.ok(), `create org project: ${res.status()} ${await res.text()}`).toBe(
    true,
  );
  return ((await res.json()) as { id: string }).id;
}

async function createOrgConversation(
  creator: ProvisionedApiUser,
  projectId: string,
): Promise<string> {
  const res = await creator.api.post(`/api/v1/projects/${projectId}/conversations`, {
    data: {
      data: randomBase64(48),
      public_key: randomBase64(32),
      wrapped_conversation_secret_key: randomBase64(48),
    },
  });
  expect(res.ok(), `create org conversation: ${res.status()} ${await res.text()}`).toBe(
    true,
  );
  return ((await res.json()) as { id: string }).id;
}

async function addProjectParticipant(
  admin: ProvisionedApiUser,
  projectId: string,
  userId: string,
  role: 'Admin' | 'Editor' | 'Viewer',
): Promise<void> {
  const res = await admin.api.post(`/api/v1/projects/${projectId}/participants`, {
    data: {
      user_id: userId,
      role,
      wrapped_project_key: randomBase64(48),
    },
  });
  expect(
    res.status(),
    `add project participant: ${res.status()} ${await res.text()}`,
  ).toBe(201);
}

async function superuserApi(): Promise<APIRequestContext> {
  const setup = await request.newContext(API_CONTEXT_OPTIONS);
  const authed = await setup.post('/api/collections/_superusers/auth-with-password', {
    data: { identity: SUPERUSER_EMAIL, password: SUPERUSER_PASSWORD },
  });
  expect(authed.ok(), `superuser auth: ${authed.status()} ${await authed.text()}`).toBe(
    true,
  );
  const { token } = (await authed.json()) as { token: string };
  await setup.dispose();
  return request.newContext({
    ...API_CONTEXT_OPTIONS,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

async function readProjectAsSuperuser(projectId: string): Promise<{
  id: string;
  organisation: string;
  rotation_pending: boolean;
}> {
  const su = await superuserApi();
  try {
    const res = await su.get(`/api/collections/projects/records/${projectId}`);
    expect(res.ok(), `read project: ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as {
      id: string;
      organisation: string;
      rotation_pending: boolean;
    };
  } finally {
    await su.dispose();
  }
}

async function readConversationAsSuperuser(conversationId: string): Promise<{
  id: string;
  project: string;
} | null> {
  const su = await superuserApi();
  try {
    const res = await su.get(
      `/api/collections/conversations/records/${conversationId}`,
    );
    if (res.status() === 404) {
      return null;
    }
    expect(res.ok(), `read conversation: ${res.status()} ${await res.text()}`).toBe(
      true,
    );
    return (await res.json()) as { id: string; project: string };
  } finally {
    await su.dispose();
  }
}

async function countDetachedBillingRows(): Promise<number> {
  const su = await superuserApi();
  try {
    const res = await su.get('/api/collections/user_billing/records', {
      params: { filter: `user_id=''`, perPage: 200 },
    });
    expect(res.ok(), `list detached billing: ${res.status()}`).toBe(true);
    const body = (await res.json()) as { items: unknown[]; totalItems: number };
    return body.totalItems ?? body.items.length;
  } finally {
    await su.dispose();
  }
}

test.describe('Account deletion + Organisation safety (OP-001)', () => {
  test('anonymous DELETE /account → 401', async () => {
    const api = await newAnonymousApi();
    try {
      const res = await api.delete('/api/v1/account', {
        data: { password: 'irrelevant' },
        headers: { 'content-type': 'application/json' },
      });
      expect(res.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('Organisation Owner receives 409 until transfer or dissolve', async () => {
    const owner = await provisionApiUser();
    try {
      const orgRes = await owner.api.post('/api/v1/orgs', {
        data: { name: 'Owner Block E2E AG' },
      });
      expect(orgRes.status()).toBe(201);
      const { id: orgId } = (await orgRes.json()) as { id: string };

      const res = await deleteAccount(owner);
      expect(res.status(), await res.text()).toBe(409);
      expect(await res.json()).toMatchObject({
        message: expect.stringMatching(/transfer ownership or dissolve/i),
      });

      // Owner and Organisation remain intact.
      expect((await owner.api.get('/api/v1/billing')).status()).toBe(200);
      expect((await owner.api.get(`/api/v1/orgs/${orgId}`)).status()).toBe(200);
    } finally {
      await owner.api.dispose();
    }
  });

  test('member Account deletion keeps Organisation Projects they created', async () => {
    const owner = await provisionApiUser();
    const member = await provisionApiUser();
    try {
      const orgRes = await owner.api.post('/api/v1/orgs', {
        data: { name: 'Survive E2E AG' },
      });
      expect(orgRes.status()).toBe(201);
      const { id: orgId } = (await orgRes.json()) as { id: string };
      await upsertOrgBilling(orgId, { planType: 'payg', seats: 3 });
      await inviteAndAccept(owner, member, orgId);

      // Member creates the shared Project — the P0 bug deleted these by creator.
      const orgProjectId = await createOrgProject(member, orgId);
      await addProjectParticipant(member, orgProjectId, owner.userId, 'Admin');
      const orgConversationId = await createOrgConversation(member, orgProjectId);

      const personalProjectRes = await member.api.post('/api/v1/projects', {
        data: {
          data: randomBase64(48),
          wrapped_project_key: randomBase64(48),
        },
      });
      expect(personalProjectRes.status()).toBe(201);
      const { id: personalProjectId } = (await personalProjectRes.json()) as {
        id: string;
      };

      const personalConvRes = await member.api.post('/api/v1/conversations', {
        data: {
          data: randomBase64(48),
          expiry_duration: '',
        },
      });
      expect(
        personalConvRes.ok(),
        `personal conversation: ${personalConvRes.status()} ${await personalConvRes.text()}`,
      ).toBe(true);
      const { id: personalConversationId } = (await personalConvRes.json()) as {
        id: string;
      };

      const deleted = await deleteAccount(member);
      expect(deleted.status(), await deleted.text()).toBe(204);

      // Member token is dead.
      expect((await member.api.get('/api/v1/billing')).status()).toBe(401);

      // Organisation content survives for the Owner.
      expect((await owner.api.get(`/api/v1/projects/${orgProjectId}`)).status()).toBe(
        200,
      );
      const survivingConversation =
        await readConversationAsSuperuser(orgConversationId);
      expect(
        survivingConversation,
        'organisation conversation must survive',
      ).not.toBeNull();
      expect(survivingConversation?.project).toBe(orgProjectId);

      // Personal rows are gone (owner probing must not find them either).
      expect(
        (await owner.api.get(`/api/v1/projects/${personalProjectId}`)).status(),
      ).toBe(404);
      expect(await readConversationAsSuperuser(personalConversationId)).toBeNull();

      const surviving = await readProjectAsSuperuser(orgProjectId);
      expect(surviving.organisation).toBe(orgId);
      expect(surviving.rotation_pending).toBe(true);
    } finally {
      await owner.api.dispose();
      await member.api.dispose();
    }
  });

  test('ordinary member is offboarded with Project access revoked before erase', async () => {
    const owner = await provisionApiUser();
    const member = await provisionApiUser();
    try {
      const orgRes = await owner.api.post('/api/v1/orgs', {
        data: { name: 'Offboard E2E AG' },
      });
      expect(orgRes.status()).toBe(201);
      const { id: orgId } = (await orgRes.json()) as { id: string };
      await upsertOrgBilling(orgId, { planType: 'payg', seats: 3 });
      await inviteAndAccept(owner, member, orgId);

      const orgProjectId = await createOrgProject(owner, orgId);
      await addProjectParticipant(owner, orgProjectId, member.userId, 'Editor');

      const deleted = await deleteAccount(member);
      expect(deleted.status(), await deleted.text()).toBe(204);

      expect((await member.api.get('/api/v1/orgs')).status()).toBe(401);

      const membersRes = await owner.api.get(`/api/v1/orgs/${orgId}/members`);
      expect(membersRes.ok()).toBe(true);
      const members = (await membersRes.json()) as { user_id: string }[];
      expect(members.map((m) => m.user_id)).toEqual([owner.userId]);

      const participantsRes = await owner.api.get(
        `/api/v1/projects/${orgProjectId}/participants`,
      );
      expect(participantsRes.ok()).toBe(true);
      const participants = (await participantsRes.json()) as {
        participants: { user_id: string }[];
      };
      expect(participants.participants.map((p) => p.user_id)).toEqual([owner.userId]);

      const project = await readProjectAsSuperuser(orgProjectId);
      expect(project.rotation_pending).toBe(true);
    } finally {
      await owner.api.dispose();
      await member.api.dispose();
    }
  });

  test('personal data deletes while detached financial records survive', async () => {
    const owner = await provisionApiUser();
    const member = await provisionApiUser();
    try {
      const orgRes = await owner.api.post('/api/v1/orgs', {
        data: { name: 'Finance E2E AG' },
      });
      expect(orgRes.status()).toBe(201);
      const { id: orgId } = (await orgRes.json()) as { id: string };
      await upsertOrgBilling(orgId, { planType: 'payg', seats: 3 });
      await inviteAndAccept(owner, member, orgId);

      const orgProjectId = await createOrgProject(owner, orgId);
      await addProjectParticipant(owner, orgProjectId, member.userId, 'Editor');

      const personalConvRes = await member.api.post('/api/v1/conversations', {
        data: {
          data: randomBase64(48),
          expiry_duration: '',
        },
      });
      expect(personalConvRes.ok()).toBe(true);
      const { id: personalConversationId } = (await personalConvRes.json()) as {
        id: string;
      };

      const detachedBefore = await countDetachedBillingRows();

      const deleted = await deleteAccount(member);
      expect(deleted.status(), await deleted.text()).toBe(204);

      expect(await readConversationAsSuperuser(personalConversationId)).toBeNull();
      expect((await owner.api.get(`/api/v1/projects/${orgProjectId}`)).status()).toBe(
        200,
      );

      const detachedAfter = await countDetachedBillingRows();
      expect(detachedAfter).toBeGreaterThan(detachedBefore);
    } finally {
      await owner.api.dispose();
      await member.api.dispose();
    }
  });
});
