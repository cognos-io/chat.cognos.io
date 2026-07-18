import { expect, test } from '@playwright/test';

import { provisionApiUser } from './api-helpers';
import {
  apiLogin,
  composer,
  createApiUserKeyPair,
  createOrgProjectViaApi,
  expectNoRawI18nKeys,
  makeShooter,
  provisionUnlockedAccount,
  setOrgPastDue,
  upsertOrgBilling,
  userPublicKeyB64,
} from './persona-helpers';

// PERSONA WALKTHROUGH — Nils Baumann (PER-006), associate / org member.
// Nils accepts Sophie's invite with the account he already has (no new
// identity, no second Emergency Kit), works in an org-owned Project billed to
// the firm, always knows which context is billed, survives an org billing
// lapse without losing a word (and without his personal plan being touched),
// and keeps everything personal after being offboarded.
//
// Sophie exists API-side only here; Nils is the browser session under test.

const ORG_NAME = 'Vuille & Partners';

test.describe('persona walkthrough: Nils — org member professional', () => {
  test('invite accept → workspace switching → org project work → lapse → offboard safety', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const shot = makeShooter(page, 'nils');

    // ------------------------------------------------------------------
    // Sophie (API): org + active pooled billing for 2 seats.
    const sophie = await provisionApiUser();
    const orgId = await test.step('Sophie (API): org with active billing', async () => {
      const res = await sophie.api.post('/api/v1/orgs', { data: { name: ORG_NAME } });
      expect(res.ok(), `create org: ${res.status()}`).toBe(true);
      const { id } = (await res.json()) as { id: string };
      await upsertOrgBilling(id, { planType: 'payg', seats: 2 });
      return id;
    });

    try {
      // ------------------------------------------------------------------
      const { account: nilsAccount } =
        await test.step('Nils signs up and works personally first', async () => {
          const created = await provisionUnlockedAccount(page);
          // A personal conversation that must survive everything that follows.
          await composer(page).fill('Personal journal note — mine, on my plan');
          await page.getByRole('button', { name: /^send$/i }).click();
          await expect(page.getByText('Mocked assistant reply')).toBeVisible();
          await shot('personal-conversation-before-org');
          return created;
        });
      const nilsApi = await apiLogin(nilsAccount);

      const inviteToken = await test.step('Sophie (API): invite for Nils', async () => {
        const res = await sophie.api.post(`/api/v1/orgs/${orgId}/invites`, {
          data: { email: nilsAccount.email, role: 'member' },
        });
        expect(res.ok(), `invite: ${res.status()}`).toBe(true);
        return ((await res.json()) as { token: string }).token;
      });

      // ------------------------------------------------------------------
      await test.step('accept via /invite?token= deep link — same account, welcome copy', async () => {
        await page.goto(`/invite?token=${encodeURIComponent(inviteToken)}`);

        await expect(
          page.getByRole('heading', { name: `Welcome to ${ORG_NAME}` }),
        ).toBeVisible();
        await expect(page.getByText('You joined as')).toBeVisible();
        await expect(page.getByText('Member', { exact: true })).toBeVisible();
        // Friction #3: SAME account — no new identity, no second Emergency Kit.
        await expect(
          page.getByText(
            'You joined with the Cognos account you already have — same sign-in, same Account Key, no new Emergency Kit.',
          ),
        ).toBeVisible();
        // Billing separation stated up front (friction #1/secondary goal).
        await expect(
          page.getByText(
            `Work in ${ORG_NAME} Projects is billed to the organisation. Your personal chats stay yours and stay billed to you.`,
          ),
        ).toBeVisible();
        // The workspace switch should have happened automatically — the
        // manual "use the switcher" hint is the fallback, not the norm.
        await expect
          .soft(page.getByText(`Use the workspace switcher in the sidebar`))
          .toBeHidden();
        await expectNoRawI18nKeys(page, 'invite accept welcome');
        await shot('invite-accepted-welcome');

        await page.getByRole('button', { name: 'Start working' }).click();
        await expect(page).toHaveURL(/\/$/);
      });

      const trigger = page.getByTestId('workspace-switcher-trigger');

      await test.step('lands in the org workspace, clearly labelled', async () => {
        await expect(trigger).toBeVisible();
        await expect(trigger).toContainText(ORG_NAME);
        // The composer cue disambiguates: in an org workspace, a NEW chat
        // outside any Project still bills Nils personally (friction #1).
        await expect(page.getByTestId('workspace-context-badge')).toBeVisible();
        await expect(page.getByTestId('workspace-context-badge')).toContainText(
          'Personal — billed to you',
        );
        await expectNoRawI18nKeys(page, 'org workspace home');
        await shot('org-workspace-home');
      });

      // ------------------------------------------------------------------
      await test.step('draft survives Personal ⇄ Org switching', async () => {
        const draft = 'Client memo draft — must never be lost by a workspace switch';
        await composer(page).fill(draft);

        await trigger.click();
        await page.getByRole('menuitem', { name: /Personal.*Billed to you/s }).click();
        await expect(trigger).toContainText('Personal');
        await expect(composer(page)).toHaveValue(draft);

        await trigger.click();
        await page
          .getByRole('menuitem', { name: new RegExp(`${ORG_NAME}.*Billed to`, 's') })
          .click();
        await expect(trigger).toContainText(ORG_NAME);
        await expect(composer(page)).toHaveValue(draft);
        await shot('draft-preserved-after-switch');
        await composer(page).fill('');
      });

      // ------------------------------------------------------------------
      // An org-owned Project for Nils, with Sophie holding a second real
      // wrapped key as Project Admin so Nils can be offboarded safely.
      const projectId = await test.step('org project seeded for Nils', async () => {
        const publicKey = await userPublicKeyB64(nilsApi.userId);
        const sophiePublicKey = await createApiUserKeyPair(sophie.api);
        return createOrgProjectViaApi(nilsApi.api, orgId, publicKey, 'Client memos', {
          userId: sophie.userId,
          publicKeyB64: sophiePublicKey,
        });
      });

      await test.step('billing cue on the org project composer + working completion', async () => {
        await page.reload(); // pick up the seeded project
        await expect(trigger).toContainText(ORG_NAME);
        await page.goto(`/account/projects/${projectId}`);
        await expect(page.getByRole('heading', { name: 'Client memos' })).toBeVisible();
        await shot('org-project-detail');

        await page.getByRole('button', { name: 'New chat' }).click();
        await expect(page).toHaveURL(/\/c\/[^/]+$/, { timeout: 15_000 });

        // The cue must now say the FIRM pays (friction #1).
        const badge = page.getByTestId('workspace-context-badge');
        await expect(badge).toBeVisible();
        await expect(badge).toContainText(`Billed to ${ORG_NAME}`);
        await shot('org-project-composer-billing-cue');

        await composer(page).fill('Draft the client memo intro, please.');
        await page.getByRole('button', { name: /^send$/i }).click();
        await expect(page.getByText('Mocked assistant reply')).toBeVisible();
        await expectNoRawI18nKeys(page, 'org project conversation');
        await shot('org-project-completion-works');
      });

      // ------------------------------------------------------------------
      await test.step('org billing lapses → send blocked with MEMBER copy, nothing lost', async () => {
        const personalBefore = await nilsApi.api.get('/api/v1/billing');
        const balanceBefore = (
          (await personalBefore.json()) as {
            balance_chf: number;
          }
        ).balance_chf;

        await setOrgPastDue(orgId, true);

        const followUp = 'Follow-up sent after the firm card failed';
        await composer(page).fill(followUp);
        await page.getByRole('button', { name: /^send$/i }).click();

        // Inline banner: the pause is the org's, not Nils's fault; his text
        // is kept; personal workspace unaffected (friction #2).
        await expect(page.getByText(`${ORG_NAME} has a payment issue`)).toBeVisible({
          timeout: 15_000,
        });
        await expect(
          page.getByText(/Your message is kept, and nothing is lost\./),
        ).toBeVisible();
        await expect(
          page.getByText('Your personal workspace keeps working as usual.'),
        ).toBeVisible();
        await expect(
          page.getByText(
            `Ask an owner or admin of ${ORG_NAME} to restore billing — this isn't something you did.`,
          ),
        ).toBeVisible();
        // MEMBER copy only — no admin actions for Nils.
        await expect(
          page.getByRole('button', { name: 'Open team billing' }),
        ).toHaveCount(0);
        await expect(page.getByText(/Update the payment method/)).toHaveCount(0);
        // The draft is kept in the composer only. It must not remain as an
        // optimistic transcript bubble that falsely looks delivered.
        await expect(composer(page)).toHaveValue(followUp);
        await expect(page.getByText(followUp, { exact: true })).toHaveCount(0);
        await expectNoRawI18nKeys(page, 'org billing lapse banner');
        await shot('org-lapse-member-banner');

        // Fail closed must NEVER reroute to the member's personal balance.
        const personalAfter = await nilsApi.api.get('/api/v1/billing');
        const balanceAfter = (
          (await personalAfter.json()) as {
            balance_chf: number;
          }
        ).balance_chf;
        expect(balanceAfter).toBe(balanceBefore);
      });

      await test.step('personal workspace still works during the org lapse', async () => {
        await trigger.click();
        await page.getByRole('menuitem', { name: /Personal.*Billed to you/s }).click();
        await expect(trigger).toContainText('Personal');
        await page.getByRole('button', { name: /new chat/i }).click();
        // Wait out the navigation + composer re-render before typing, so the
        // draft lands in the NEW chat's composer (not the torn-down one).
        await expect(page).toHaveURL(/\/$/);
        await expect(composer(page)).toHaveValue('');

        await composer(page).fill('Personal work continues during the org lapse');
        await expect(composer(page)).toHaveValue(
          'Personal work continues during the org lapse',
        );
        await page.getByRole('button', { name: /^send$/i }).click();
        await expect(page.getByText('Mocked assistant reply').first()).toBeVisible();
        await shot('personal-works-during-lapse');
      });

      // ------------------------------------------------------------------
      await test.step('offboarded: org gone, personal account fully intact', async () => {
        const res = await sophie.api.delete(
          `/api/v1/orgs/${orgId}/members/${nilsApi.userId}`,
        );
        expect(res.status()).toBe(200);
        const offboarded = (await res.json()) as { rotation_project_ids: string[] };
        expect(offboarded.rotation_project_ids).toEqual([projectId]);

        await page.goto('/');
        // No memberships left → the switcher disappears entirely; Nils's
        // account is a plain personal account again.
        await expect(page.getByTestId('workspace-switcher-trigger')).toHaveCount(0);
        // His personal conversations are untouched (friction #4).
        const personalConversation = page.getByRole('link', {
          name: 'Mocked conversation title',
        });
        await expect(personalConversation.first()).toBeVisible();
        await personalConversation.first().click();
        await expect(page.getByText('Mocked assistant reply').first()).toBeVisible();
        await expectNoRawI18nKeys(page, 'post-offboard home');
        await shot('offboarded-personal-intact');

        // And his personal plan still answers on the API.
        const billing = await nilsApi.api.get('/api/v1/billing');
        expect(billing.ok()).toBe(true);
      });

      await nilsApi.api.dispose();
    } finally {
      await sophie.api.dispose();
    }
  });
});
