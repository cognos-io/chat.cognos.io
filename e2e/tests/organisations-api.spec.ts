import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { newAnonymousApi, provisionApiUser } from './api-helpers';
import { setOrgPastDue, upsertOrgBilling } from './persona-helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrgResponse {
  id: string;
  name: string;
  created: string;
  updated: string;
}

type OrgListResponse = Array<{
  id: string;
  name: string;
  caller_role: string;
}>;

interface OrgMember {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
}

type OrgMembersResponse = OrgMember[];

interface OrgInviteCreateResponse {
  token: string;
}

interface OrgInviteListItem {
  id: string;
  role: string;
  invited_email?: string;
  expires_at: string;
  consumed_at?: string;
}

interface OrgInviteAcceptResponse {
  organisation: string;
  role: string;
}

interface UserKeyPairBody {
  public_key: string;
  secret_key: string;
  password_salt: string;
  unlock_scheme: string;
  record_mac: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomBase64(bytes: number): string {
  return randomBytes(bytes).toString('base64');
}

function makeUserKeyPairBody(): UserKeyPairBody {
  return {
    public_key: randomBase64(32),
    secret_key: randomBase64(64),
    password_salt: randomBase64(16),
    unlock_scheme: 'account_key_v2',
    record_mac: randomBase64(32),
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('organisations API lifecycle', () => {
  test('lapsed Organisation is read-only across direct content writes', async () => {
    const owner = await provisionApiUser();
    try {
      const orgRes = await owner.api.post('/api/v1/orgs', {
        data: { name: 'Read-only E2E AG' },
      });
      expect(orgRes.status()).toBe(201);
      const { id: orgId } = (await orgRes.json()) as { id: string };
      await upsertOrgBilling(orgId, { planType: 'payg', seats: 1 });

      const projectRes = await owner.api.post('/api/v1/projects', {
        data: {
          data: randomBase64(48),
          wrapped_project_key: randomBase64(48),
          organisation: orgId,
        },
      });
      expect(projectRes.status()).toBe(201);
      const { id: projectId } = (await projectRes.json()) as { id: string };

      expect(
        (
          await owner.api.patch(`/api/v1/projects/${projectId}`, {
            data: { data: randomBase64(48) },
          })
        ).status(),
      ).toBe(200);

      await setOrgPastDue(orgId, true);

      for (const response of [
        await owner.api.patch(`/api/v1/projects/${projectId}`, {
          data: { data: randomBase64(48) },
        }),
        await owner.api.post(`/api/v1/projects/${projectId}/conversations`, {
          data: {
            data: randomBase64(48),
            public_key: randomBase64(32),
            wrapped_conversation_secret_key: randomBase64(48),
          },
        }),
      ]) {
        expect(response.status()).toBe(402);
        expect(await response.json()).toMatchObject({
          data: {
            error: 'ORG_BILLING_PAST_DUE',
            organisation_id: orgId,
          },
        });
      }

      const personalRes = await owner.api.post('/api/v1/projects', {
        data: { data: randomBase64(48), wrapped_project_key: randomBase64(48) },
      });
      expect(personalRes.status()).toBe(201);
      const { id: personalId } = (await personalRes.json()) as { id: string };
      expect(
        (
          await owner.api.patch(`/api/v1/projects/${personalId}`, {
            data: { data: randomBase64(48) },
          })
        ).status(),
      ).toBe(200);
    } finally {
      await owner.api.dispose();
    }
  });

  test('Owner dissolution requires explicit Project deletion and preserves personal access', async () => {
    const owner = await provisionApiUser();
    const outsider = await provisionApiUser();
    try {
      const orgRes = await owner.api.post('/api/v1/orgs', {
        data: { name: 'Dissolution E2E AG' },
      });
      expect(orgRes.status()).toBe(201);
      const { id: orgId } = (await orgRes.json()) as { id: string };
      await upsertOrgBilling(orgId, { planType: 'payg', seats: 1 });

      const projectRes = await owner.api.post('/api/v1/projects', {
        data: {
          data: randomBase64(48),
          wrapped_project_key: randomBase64(48),
          organisation: orgId,
        },
      });
      expect(projectRes.status()).toBe(201);
      const { id: projectId } = (await projectRes.json()) as { id: string };

      expect((await owner.api.delete(`/api/v1/orgs/${orgId}`)).status()).toBe(409);
      expect((await outsider.api.delete(`/api/v1/orgs/${orgId}`)).status()).toBe(404);

      const dissolved = await owner.api.delete(`/api/v1/orgs/${orgId}`, {
        data: JSON.stringify({ delete_projects: true }),
        headers: { 'content-type': 'application/json' },
      });
      expect(
        dissolved.status(),
        `dissolve: ${dissolved.status()} ${await dissolved.text()}`,
      ).toBe(204);
      expect(await (await owner.api.get('/api/v1/orgs')).json()).toEqual([]);
      expect((await owner.api.get(`/api/v1/projects/${projectId}`)).status()).toBe(404);
      expect((await owner.api.get('/api/v1/billing')).status()).toBe(200);
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });

  test('full org lifecycle: create, invite, accept, billing gate, offboard, public-key access', async () => {
    // -----------------------------------------------------------------------
    // 1. Create two fresh users
    // -----------------------------------------------------------------------
    const userA = await test.step('provision user A (future owner)', async () =>
      provisionApiUser());
    const userB = await test.step('provision user B (future member)', async () =>
      provisionApiUser());

    try {
      // ---------------------------------------------------------------------
      // 2. A creates an org → owner role; GET /orgs lists it; B's GET is empty
      // ---------------------------------------------------------------------
      await test.step('A creates an organisation', async () => {
        const res = await userA.api.post('/api/v1/orgs', {
          data: { name: 'Acme E2E GmbH' },
        });
        expect(res.ok(), `create org: ${res.status()} ${await res.text()}`).toBe(true);
        expect(res.status()).toBe(201);

        const body = (await res.json()) as OrgResponse;
        expect(body.name).toBe('Acme E2E GmbH');
      });

      let orgId: string;
      let inviteToken: string;

      await test.step('A lists orgs and sees ownership', async () => {
        const res = await userA.api.get('/api/v1/orgs');
        expect(res.ok()).toBe(true);

        const body = (await res.json()) as OrgListResponse;
        expect(body.length).toBe(1);
        expect(body[0].caller_role).toBe('owner');
        orgId = body[0].id;
      });

      await test.step("B's org list is empty", async () => {
        const res = await userB.api.get('/api/v1/orgs');
        expect(res.ok()).toBe(true);

        const body = (await res.json()) as OrgListResponse;
        expect(body).toEqual([]);
      });

      // ---------------------------------------------------------------------
      // 3. Cross-user denial: B cannot access A's org
      // ---------------------------------------------------------------------
      await test.step('B GET /orgs/{id} → 404', async () => {
        const res = await userB.api.get(`/api/v1/orgs/${orgId}`);
        expect(res.status()).toBe(404);
      });

      await test.step('B PATCH /orgs/{id} → 404', async () => {
        const res = await userB.api.patch(`/api/v1/orgs/${orgId}`, {
          data: { name: 'Hijacked' },
        });
        expect(res.status()).toBe(404);
      });

      await test.step('B GET /orgs/{id}/members → 404', async () => {
        const res = await userB.api.get(`/api/v1/orgs/${orgId}/members`);
        expect(res.status()).toBe(404);
      });

      await test.step('B cannot create invites → 404', async () => {
        const res = await userB.api.post(`/api/v1/orgs/${orgId}/invites`, {
          data: { email: userB.account.email, role: 'member' },
        });
        expect(res.status()).toBe(404);
      });

      await test.step('A renames the organisation and reads the persisted name', async () => {
        const updateRes = await userA.api.patch(`/api/v1/orgs/${orgId}`, {
          data: { name: 'Acme E2E Group AG' },
        });
        expect(
          updateRes.ok(),
          `update org: ${updateRes.status()} ${await updateRes.text()}`,
        ).toBe(true);
        expect((await updateRes.json()) as OrgResponse).toMatchObject({
          id: orgId,
          name: 'Acme E2E Group AG',
        });

        const getRes = await userA.api.get(`/api/v1/orgs/${orgId}`);
        expect(getRes.ok()).toBe(true);
        expect((await getRes.json()) as OrgResponse).toMatchObject({
          id: orgId,
          name: 'Acme E2E Group AG',
        });
      });

      // ---------------------------------------------------------------------
      // 4. Invite flow: A invites B, B accepts, second accept → 404
      // ---------------------------------------------------------------------
      await test.step('A revokes a pending invite', async () => {
        const createRes = await userA.api.post(`/api/v1/orgs/${orgId}/invites`, {
          data: { email: `revoked-${Date.now()}@example.com`, role: 'member' },
        });
        expect(createRes.status()).toBe(201);

        const listRes = await userA.api.get(`/api/v1/orgs/${orgId}/invites`);
        expect(listRes.ok()).toBe(true);
        const pending = (await listRes.json()) as OrgInviteListItem[];
        expect(pending).toHaveLength(1);

        const revokeRes = await userA.api.delete(
          `/api/v1/orgs/${orgId}/invites/${pending[0].id}`,
        );
        expect(revokeRes.status()).toBe(204);

        const afterRes = await userA.api.get(`/api/v1/orgs/${orgId}/invites`);
        expect(afterRes.ok()).toBe(true);
        expect((await afterRes.json()) as OrgInviteListItem[]).toEqual([]);
      });

      await test.step('A creates a member invite → token returned once', async () => {
        const res = await userA.api.post(`/api/v1/orgs/${orgId}/invites`, {
          data: { email: userB.account.email, role: 'member' },
        });
        expect(res.ok(), `create invite: ${res.status()} ${await res.text()}`).toBe(
          true,
        );
        expect(res.status()).toBe(201);

        const body = (await res.json()) as OrgInviteCreateResponse;
        expect(body.token).toBeTruthy();
        expect(body.token.length).toBeGreaterThan(10);
        inviteToken = body.token;
      });

      await test.step('A lists invites — pending shown without token', async () => {
        const res = await userA.api.get(`/api/v1/orgs/${orgId}/invites`);
        expect(res.ok()).toBe(true);

        const body = (await res.json()) as OrgInviteListItem[];
        expect(body.length).toBe(1);
        expect(body[0].role).toBe('member');
        expect(body[0].consumed_at).toBeUndefined();
        // Token must NOT appear in list response
        expect((body[0] as Record<string, unknown>).token).toBeUndefined();
        expect((body[0] as Record<string, unknown>).token_hash).toBeUndefined();
      });

      await test.step('B accepts invite → 200 with org + role', async () => {
        const res = await userB.api.post('/api/v1/org-invites/accept', {
          data: { token: inviteToken },
        });
        expect(res.ok(), `accept invite: ${res.status()} ${await res.text()}`).toBe(
          true,
        );
        expect(res.status()).toBe(200);

        const body = (await res.json()) as OrgInviteAcceptResponse;
        expect(body.organisation).toBe(orgId);
        expect(body.role).toBe('member');
      });

      await test.step('second accept with same token → 404', async () => {
        const res = await userB.api.post('/api/v1/org-invites/accept', {
          data: { token: inviteToken },
        });
        expect(res.status()).toBe(404);
      });

      await test.step("A's members list now shows B", async () => {
        const res = await userA.api.get(`/api/v1/orgs/${orgId}/members`);
        expect(res.ok()).toBe(true);

        const body = (await res.json()) as OrgMembersResponse;
        const bMember = body.find((m) => m.user_id === userB.userId);
        expect(bMember).toBeTruthy();
        expect(bMember!.email).toBe(userB.account.email);
        expect(bMember!.role).toBe('member');
      });

      await test.step("B's org list now shows the org", async () => {
        const res = await userB.api.get('/api/v1/orgs');
        expect(res.ok()).toBe(true);

        const body = (await res.json()) as OrgListResponse;
        expect(body.length).toBe(1);
        expect(body[0].id).toBe(orgId);
        expect(body[0].caller_role).toBe('member');
      });

      // ---------------------------------------------------------------------
      // 5. Billing gate: without org_billing, org completion 402s
      //    Also verify billing GET permissions.
      // ---------------------------------------------------------------------
      await test.step('owner starts checkout for all active Seats', async () => {
        const res = await userA.api.post(`/api/v1/orgs/${orgId}/billing/checkout`);
        expect(res.ok(), `checkout: ${res.status()} ${await res.text()}`).toBe(true);
        expect(await res.json()).toEqual({
          checkout_url: 'https://checkout.paddle.test/e2e-organisation',
        });
      });

      await test.step('owner opens the organisation billing portal', async () => {
        const res = await userA.api.get(`/api/v1/orgs/${orgId}/billing/portal`);
        expect(res.ok(), `portal: ${res.status()} ${await res.text()}`).toBe(true);
        expect(await res.json()).toEqual({
          portal_url: 'https://customer-portal.paddle.test/e2e-organisation',
        });
      });

      await test.step('owner can read the empty usage summary before activation', async () => {
        const res = await userA.api.get(`/api/v1/orgs/${orgId}/usage`);
        expect(res.ok(), `usage: ${res.status()} ${await res.text()}`).toBe(true);
        expect(await res.json()).toMatchObject({ total_rappen: 0, members: null });
      });

      await test.step('org billing GET for owner → inactive/missing shape', async () => {
        const res = await userA.api.get(`/api/v1/orgs/${orgId}/billing`);
        // No activation webhook received → org_billing row does not exist. Pin: the handler
        // reports the fail-closed default shape (inactive) rather than a 404,
        // which is what the admin UI's create-then-checkout flow builds on.
        expect(res.status()).toBe(200);
        const billing = (await res.json()) as { plan_type: string };
        expect(billing.plan_type).toBe('inactive');
      });

      await test.step('org billing GET for member → 403', async () => {
        const res = await userB.api.get(`/api/v1/orgs/${orgId}/billing`);
        expect(res.status()).toBe(403);
      });

      await test.step('non-member billing GET → 404', async () => {
        const outsider = await provisionApiUser();
        try {
          const res = await outsider.api.get(`/api/v1/orgs/${orgId}/billing`);
          expect(res.status()).toBe(404);
        } finally {
          await outsider.api.dispose();
        }
      });

      await test.step('org project completion without billing → 402', async () => {
        // The security gate also blocks creating new org Projects while
        // billing is inactive, so create this fixture while active and then
        // lapse it before the completion attempt.
        await upsertOrgBilling(orgId, { planType: 'payg', seats: 1 });
        // Create an org-owned project via the projects API.
        const projectRes = await userA.api.post('/api/v1/projects', {
          data: {
            data: Buffer.from(JSON.stringify({ name: 'Org Project' })).toString(
              'base64',
            ),
            wrapped_project_key: Buffer.from(
              'org-project-key-material-0000000000000000',
            ).toString('base64'),
            organisation: orgId,
          },
        });

        expect(
          projectRes.ok(),
          `create project: ${projectRes.status()} ${await projectRes.text()}`,
        ).toBe(true);
        const projectBody = (await projectRes.json()) as { id: string };
        const projectId = projectBody.id;

        // Create a standalone conversation, then move it into the org project
        // (metadata + key wrapping change together, like the app does).
        const convRes = await userA.api.post('/api/v1/conversations', {
          data: {
            data: Buffer.from(JSON.stringify({ title: 'Billing gate test' })).toString(
              'base64',
            ),
            expiry_duration: '',
          },
        });
        expect(
          convRes.ok(),
          `create conversation: ${convRes.status()} ${await convRes.text()}`,
        ).toBe(true);
        const convBody = (await convRes.json()) as { id: string };
        const conversationId = convBody.id;

        // Post the conversation public key (required for complete).
        const keyRes = await userA.api.post(
          `/api/v1/conversations/${conversationId}/public-key`,
          {
            data: {
              public_key: randomBase64(32),
              public_key_signature: randomBase64(32),
            },
          },
        );
        expect(
          keyRes.ok(),
          `public-key: ${keyRes.status()} ${await keyRes.text()}`,
        ).toBe(true);

        // Move the conversation into the org-owned project.
        const moveRes = await userA.api.patch(
          `/api/v1/conversations/${conversationId}/project`,
          {
            data: {
              project_id: projectId,
              wrapped_conversation_secret_key: randomBase64(48),
            },
          },
        );
        expect(moveRes.ok(), `move: ${moveRes.status()} ${await moveRes.text()}`).toBe(
          true,
        );

        await upsertOrgBilling(orgId, { planType: 'inactive', seats: 1 });

        // Attempt completion — should 402 because org has no billing.
        const completeRes = await userA.api.post(
          `/api/v1/conversations/${conversationId}/complete`,
          {
            data: {
              model_id: 'llama-3-3-infomaniak',
              persona_id: 'cognos:simple-assistant',
              system_prompt: 'test',
              messages: [{ role: 'user', content: 'hello' }],
            },
          },
        );
        expect(completeRes.status()).toBe(402);
        const completeBody = (await completeRes.json()) as {
          data?: { error?: string };
        };
        expect(completeBody.data?.error).toMatch(/ORG_BILLING/);
      });

      // ---------------------------------------------------------------------
      // 6. Offboard: A removes B → B loses access, personal account untouched
      // ---------------------------------------------------------------------
      await test.step('A offboards B and receives the Projects requiring rotation', async () => {
        const res = await userA.api.delete(
          `/api/v1/orgs/${orgId}/members/${userB.userId}`,
        );
        expect(res.status()).toBe(200);
        expect(await res.json()).toEqual({ rotation_project_ids: [] });
      });

      await test.step("B's org list is empty after offboard", async () => {
        const res = await userB.api.get('/api/v1/orgs');
        expect(res.ok()).toBe(true);

        const body = (await res.json()) as OrgListResponse;
        expect(body).toEqual([]);
      });

      await test.step('B GET /orgs/{id} → 404 after offboard', async () => {
        const res = await userB.api.get(`/api/v1/orgs/${orgId}`);
        expect(res.status()).toBe(404);
      });

      await test.step("B's personal billing still works (account untouched pin)", async () => {
        const res = await userB.api.get('/api/v1/billing');
        expect(res.ok(), `billing: ${res.status()} ${await res.text()}`).toBe(true);
        expect(res.status()).toBe(200);

        const body = (await res.json()) as { plan_type: string; balance_chf: number };
        expect(typeof body.plan_type).toBe('string');
        expect(typeof body.balance_chf).toBe('number');
      });

      // ---------------------------------------------------------------------
      // 7. Public key: A can resolve B while member; 404 after offboard
      // ---------------------------------------------------------------------
      // First, ensure B has a user key pair (required for public-key endpoint).
      // We create a fresh userC to test the public-key flow properly, because
      // userB was offboarded and we need to test the during-membership case.
      const userC = await test.step('provision user C for public-key test', async () =>
        provisionApiUser());
      try {
        await test.step('C creates a user key pair', async () => {
          const res = await userC.api.post('/api/v1/user-key-pair', {
            data: makeUserKeyPairBody(),
          });
          expect(res.ok(), `create key pair: ${res.status()} ${await res.text()}`).toBe(
            true,
          );
        });

        await test.step('A invites C and C accepts', async () => {
          const inviteRes = await userA.api.post(`/api/v1/orgs/${orgId}/invites`, {
            data: { email: userC.account.email, role: 'member' },
          });
          expect(inviteRes.ok()).toBe(true);
          const { token } = (await inviteRes.json()) as OrgInviteCreateResponse;

          const acceptRes = await userC.api.post('/api/v1/org-invites/accept', {
            data: { token },
          });
          expect(acceptRes.ok()).toBe(true);
        });

        await test.step('A can resolve C public key while C is member', async () => {
          const res = await userA.api.get(`/api/v1/users/${userC.userId}/public-key`);
          expect(res.ok(), `public-key: ${res.status()} ${await res.text()}`).toBe(
            true,
          );
          expect(res.status()).toBe(200);

          const body = (await res.json()) as { public_key: string };
          expect(body.public_key).toBeTruthy();
          expect(body.public_key.length).toBeGreaterThan(0);
        });

        await test.step('offboard C', async () => {
          const res = await userA.api.delete(
            `/api/v1/orgs/${orgId}/members/${userC.userId}`,
          );
          expect(res.status()).toBe(200);
        });

        await test.step('A GET /users/{C}/public-key → 404 after offboard', async () => {
          const res = await userA.api.get(`/api/v1/users/${userC.userId}/public-key`);
          expect(res.status()).toBe(404);
        });
      } finally {
        await userC.api.dispose();
      }
    } finally {
      await userA.api.dispose();
      await userB.api.dispose();
    }
  });

  test('unauthenticated callers are rejected from all org routes', async () => {
    const anon = await newAnonymousApi();
    try {
      await test.step('GET /orgs → 401', async () => {
        expect((await anon.get('/api/v1/orgs')).status()).toBe(401);
      });

      await test.step('POST /orgs → 401', async () => {
        expect(
          (await anon.post('/api/v1/orgs', { data: { name: 'X' } })).status(),
        ).toBe(401);
      });

      await test.step('GET /orgs/anyid → 401', async () => {
        expect((await anon.get('/api/v1/orgs/org000000000001')).status()).toBe(401);
      });

      await test.step('PATCH /orgs/anyid → 401', async () => {
        expect(
          (
            await anon.patch('/api/v1/orgs/org000000000001', {
              data: { name: 'X' },
            })
          ).status(),
        ).toBe(401);
      });

      await test.step('DELETE /orgs/anyid → 401', async () => {
        expect((await anon.delete('/api/v1/orgs/org000000000001')).status()).toBe(401);
      });

      await test.step('GET /orgs/anyid/members → 401', async () => {
        expect((await anon.get('/api/v1/orgs/org000000000001/members')).status()).toBe(
          401,
        );
      });

      await test.step('POST /orgs/anyid/invites → 401', async () => {
        expect(
          (
            await anon.post('/api/v1/orgs/org000000000001/invites', {
              data: { email: 'x@y.z', role: 'member' },
            })
          ).status(),
        ).toBe(401);
      });

      await test.step('GET /orgs/anyid/invites → 401', async () => {
        expect((await anon.get('/api/v1/orgs/org000000000001/invites')).status()).toBe(
          401,
        );
      });

      await test.step('DELETE /orgs/anyid/invites/any → 401', async () => {
        expect(
          (
            await anon.delete('/api/v1/orgs/org000000000001/invites/inv0000000001')
          ).status(),
        ).toBe(401);
      });

      await test.step('POST /org-invites/accept → 401', async () => {
        expect(
          (
            await anon.post('/api/v1/org-invites/accept', {
              data: { token: 'abc' },
            })
          ).status(),
        ).toBe(401);
      });

      await test.step('DELETE /orgs/anyid/members/any → 401', async () => {
        expect(
          (
            await anon.delete('/api/v1/orgs/org000000000001/members/usr000000000001')
          ).status(),
        ).toBe(401);
      });

      await test.step('GET /users/anyid/public-key → 401', async () => {
        expect(
          (await anon.get('/api/v1/users/usr000000000001/public-key')).status(),
        ).toBe(401);
      });

      await test.step('POST /orgs/anyid/billing/checkout → 401', async () => {
        expect(
          (await anon.post('/api/v1/orgs/org000000000001/billing/checkout')).status(),
        ).toBe(401);
      });

      await test.step('GET /orgs/anyid/billing/portal → 401', async () => {
        expect(
          (await anon.get('/api/v1/orgs/org000000000001/billing/portal')).status(),
        ).toBe(401);
      });

      await test.step('GET /orgs/anyid/usage → 401', async () => {
        expect((await anon.get('/api/v1/orgs/org000000000001/usage')).status()).toBe(
          401,
        );
      });
    } finally {
      await anon.dispose();
    }
  });
});
