import { expect, test } from '@playwright/test';

import { provisionApiUser } from './api-helpers';
import {
  apiLogin,
  expectNoRawI18nKeys,
  makeShooter,
  provisionUnlockedAccount,
  upsertOrgBilling,
} from './persona-helpers';

// PERSONA WALKTHROUGH — Sophie Vuille (PER-005), founding partner and Owner.
// Sophie creates her firm's Organisation, verifies billing is one honest
// actionable step, invites an associate, sets policies, creates an org-owned
// Project and offboards a leaver — all in one sitting, no IT step, and never
// seeing anyone's conversation content. Functionality AND design polish are
// asserted; checks that must not abort the walk use expect.soft so one broken
// step still leaves the rest of the journey inspected (the test still fails).
//
// The e2e stack has no Paddle: org activation is seeded straight into the
// locked org_billing collection via the e2e superuser (persona-helpers).

test.describe('persona walkthrough: Sophie — team lead / org Owner', () => {
  test('create org → billing → policies → invite → members → org project → offboard', async ({
    context,
    page,
  }) => {
    test.setTimeout(300_000);
    const shot = makeShooter(page, 'sophie');
    const ORG_NAME = 'Vuille Tax Advisory';

    // ------------------------------------------------------------------
    const { account } = await test.step('signup + vault setup', async () => {
      const created = await provisionUnlockedAccount(page);
      await shot('signed-up-home');
      return created;
    });

    await test.step('workspace switcher is hidden with no memberships', async () => {
      // Individual users must see zero change (spec §5.2).
      await expect(page.getByTestId('workspace-switcher-trigger')).toHaveCount(0);
    });

    // ------------------------------------------------------------------
    await test.step('create the Organisation in team settings', async () => {
      await page.goto('/account/team');
      await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
      await expectNoRawI18nKeys(page, 'team settings (create form)');

      // No SSO / IT / domain-verification language before Seat 1 (friction #1).
      const bodyText = await page.locator('body').innerText();
      expect
        .soft(bodyText, 'no SSO/SCIM/IT jargon before seat 1')
        .not.toMatch(/\b(SSO|SCIM|SAML|domain verification)\b/i);

      await page.getByLabel('Organisation name').fill(ORG_NAME);
      await shot('team-create-form');
      await page.getByRole('button', { name: 'Create Organisation' }).click();

      // Step 2 of creation: checkout card with exactly ONE actionable step.
      await expect(
        page.getByRole('heading', { name: `${ORG_NAME} is ready` }),
      ).toBeVisible();
      await expect(
        page.getByText(/your organisation will be active once checkout completes/i),
      ).toBeVisible();
      const actions = page.getByRole('button', { name: 'Add payment method' });
      await expect(actions).toHaveCount(1);
      await expectNoRawI18nKeys(page, 'org created → checkout step');
      await shot('org-created-checkout-step');
    });

    // Resolve the new org's id over the API (same account, same password).
    const sophieApi = await apiLogin(account);
    const orgId = await test.step('resolve org id via API', async () => {
      const res = await sophieApi.api.get('/api/v1/orgs');
      expect(res.ok()).toBe(true);
      const orgs = (await res.json()) as { id: string; name: string }[];
      expect(orgs.length).toBe(1);
      expect(orgs[0].name).toBe(ORG_NAME);
      return orgs[0].id;
    });

    try {
      // ------------------------------------------------------------------
      // GATE: the Owner's admin surface must survive a reload. If it does
      // not (e.g. the caller_role/role wire mismatch), record the blocker
      // and keep walking the role-independent parts of the journey.
      const adminTabs = page.getByRole('group', { name: 'Team settings tabs' });
      const adminAvailable =
        await test.step('owner sees the admin tabs after a reload', async () => {
          await page.reload();
          // Wait for the load to settle on ANY terminal state.
          await expect(
            adminTabs.or(page.getByRole('heading', { name: 'Create an Organisation' })),
          ).toBeVisible();
          const available = await adminTabs.isVisible();
          expect
            .soft(
              available,
              'BLOCKER: org Owner reloads /account/team and sees no admin surface ' +
                '(org exists server-side; suspected caller_role vs role wire mismatch)',
            )
            .toBe(true);
          if (!available) {
            await shot('BLOCKER-owner-admin-surface-missing');
          }
          return available;
        });

      if (adminAvailable) {
        // ----------------------------------------------------------------
        await test.step('billing tab shows the inactive state with ONE actionable step', async () => {
          await adminTabs.getByRole('button', { name: 'Billing & usage' }).click();

          await expect(page.getByText('Inactive', { exact: true })).toBeVisible();
          await expect(
            page.getByText(
              'This Organisation has no active billing. Add a payment method to enable full access.',
            ),
          ).toBeVisible();
          // Exactly one actionable step for the Owner (persona: "one
          // actionable step — update payment method; never a sales call").
          await expect(
            page.getByRole('button', { name: 'Add payment method' }),
          ).toHaveCount(1);
          await expectNoRawI18nKeys(page, 'billing tab (inactive)');
          await shot('billing-inactive');
        });

        // ----------------------------------------------------------------
        await test.step('activate billing (seeded webhook) → seats/floor/cycle/projection panel', async () => {
          await upsertOrgBilling(orgId, { planType: 'payg', seats: 1 });
          await page.reload();
          await adminTabs.getByRole('button', { name: 'Billing & usage' }).click();

          await expect(page.getByText('Active', { exact: true })).toBeVisible();

          // High information density where it matters: seats, cycle, floor,
          // usage so far, projection before cycle close (friction #4).
          await expect(page.getByText('Seats', { exact: true })).toBeVisible();
          await expect(page.getByText('CHF 15 per seat per month')).toBeVisible();
          await expect(page.getByText('Current cycle', { exact: true })).toBeVisible();
          await expect(page.getByText('Floor', { exact: true })).toBeVisible();
          await expect(page.getByText('Usage so far', { exact: true })).toBeVisible();
          // 1 seat → CHF 15.00 floor, nothing used yet.
          await expect(page.getByText('CHF 15.00', { exact: true })).toBeVisible();
          await expect(page.getByText('CHF 0.00', { exact: true })).toBeVisible();
          // The projected-overage element is always present pre-close.
          await expect(page.getByTestId('org-overage')).toBeVisible();
          await expect(page.getByText(/remaining under the floor/)).toBeVisible();

          // Friction #3: the dashboard must SAY it is metadata-only.
          await expect(
            page.getByText(
              /Usage and costs only — no one can see anyone else.s conversations\./,
            ),
          ).toBeVisible();
          await expect(page.getByText('No usage yet this cycle.')).toBeVisible();

          await expectNoRawI18nKeys(page, 'billing tab (active)');
          await shot('billing-active-panel');
        });

        // ----------------------------------------------------------------
        await test.step('set the retention policy to 30 days', async () => {
          await adminTabs
            .getByRole('button', { name: 'Policies', exact: true })
            .click();
          await expect(
            page.getByRole('heading', { name: 'Policies', exact: true }),
          ).toBeVisible();

          const retention = page.getByLabel('Auto-delete default (days)');
          await retention.fill('30');
          await page.getByRole('button', { name: 'Save policies' }).click();
          await expect(page.getByText('Policies updated')).toBeVisible();

          // Assert the meaningful UX contract: the saved policy survives a
          // reload and remains editable. The form deliberately does not echo
          // a second "30 days" label after saving.
          await page.reload();
          await adminTabs
            .getByRole('button', { name: 'Policies', exact: true })
            .click();
          await expect(page.getByLabel('Auto-delete default (days)')).toHaveValue('30');
          await shot('policies-retention-30-persisted');
          await expectNoRawI18nKeys(page, 'policies tab');
        });

        // ----------------------------------------------------------------
        const inviteEmail = `nils-${Date.now()}@cognos-e2e.test`;
        await test.step('create an invite — token shown exactly once, copyable', async () => {
          await adminTabs.getByRole('button', { name: 'Invites' }).click();
          await expect(
            page.getByRole('heading', { name: 'Invite a team member' }),
          ).toBeVisible();

          await page.getByLabel('Email address').fill(inviteEmail);
          // Role group is an accessible group of pressable chips.
          const roleGroup = page.getByRole('group', { name: 'Role' });
          await expect.soft(roleGroup).toBeVisible();
          await page.getByRole('button', { name: 'Create invite' }).click();

          await expect(page.getByText('Invite token created')).toBeVisible();
          await expect(
            page.getByText(
              'Copy and share this token now. It will never be shown again.',
            ),
          ).toBeVisible();
          const tokenField = page.getByRole('textbox', { name: 'Invite token' });
          await expect(tokenField).toBeVisible();
          const token = await tokenField.inputValue();
          expect(token.length).toBeGreaterThan(10);
          await shot('invite-token-shown-once');

          await context.grantPermissions(['clipboard-read', 'clipboard-write']);
          await page.getByRole('button', { name: 'Copy', exact: true }).click();
          await expect(page.getByText('Token copied to clipboard')).toBeVisible();
          await expect
            .poll(() => page.evaluate(() => navigator.clipboard.readText()))
            .toBe(token);

          // Dismiss → the token is gone for good; the list never shows it.
          await page.getByRole('button', { name: 'Done', exact: true }).click();
          await expect(page.getByText('Invite token created')).toBeHidden();
          await expect(
            page.getByRole('cell', { name: inviteEmail, exact: true }),
          ).toBeVisible();
          const pendingText = await page.locator('table').innerText();
          expect(pendingText).not.toContain(token);
          await expectNoRawI18nKeys(page, 'invites tab');
          await shot('invite-pending-list');
        });

        // ----------------------------------------------------------------
        // A real associate joins (API-side) so the members table and
        // offboard flow have a second row to work with.
        const associate = await provisionApiUser();
        try {
          await test.step('associate accepts an invite (API) → appears in members', async () => {
            const inviteRes = await sophieApi.api.post(
              `/api/v1/orgs/${orgId}/invites`,
              { data: { email: associate.account.email, role: 'member' } },
            );
            expect(inviteRes.ok(), `invite: ${inviteRes.status()}`).toBe(true);
            const { token } = (await inviteRes.json()) as { token: string };
            const acceptRes = await associate.api.post('/api/v1/org-invites/accept', {
              data: { token },
            });
            expect(acceptRes.ok(), `accept: ${acceptRes.status()}`).toBe(true);

            await page.reload();
            await adminTabs
              .getByRole('button', { name: 'Members', exact: true })
              .click();

            // Members table: accessible caption + both rows with role lozenges.
            const ownerMemberRow = page
              .getByRole('row')
              .filter({ hasText: account.email });
            const associateMemberRow = page
              .getByRole('row')
              .filter({ hasText: associate.account.email });
            await expect(ownerMemberRow).toContainText('Owner');
            await expect(associateMemberRow).toContainText('Member');
            await expectNoRawI18nKeys(page, 'members tab');
            await shot('members-list');
          });

          await test.step('offboard dialog: reassurance copy, focus, then removal', async () => {
            // The Owner's own row must NOT offer removal; the associate's must.
            const ownerRow = page.getByRole('row', {
              name: new RegExp(account.email),
            });
            await expect
              .soft(ownerRow.getByRole('button', { name: /remove/i }))
              .toBeDisabled();

            const associateRow = page.getByRole('row', {
              name: new RegExp(associate.account.email),
            });
            await associateRow.getByRole('button', { name: /remove/i }).click();

            await expect(
              page.getByRole('heading', {
                name: `Remove ${associate.account.email}?`,
              }),
            ).toBeVisible();
            // The three plain-language facts (spec §8.2, Nils's friction #4):
            await expect(
              page.getByText(
                `They will immediately lose access to everything in ${ORG_NAME}.`,
              ),
            ).toBeVisible();
            await expect(
              page.getByText(
                'Their personal account and personal chats are untouched.',
              ),
            ).toBeVisible();
            await expect(
              page.getByText(
                'The seat stays billed until the end of the current cycle.',
              ),
            ).toBeVisible();

            // DESIGN: focus must land inside the dialog (keyboard safety).
            const focusInDialog = await page.evaluate(() => {
              const active = document.activeElement;
              return active !== null && active.closest('cog-dialog-surface') !== null;
            });
            expect
              .soft(focusInDialog, 'focus lands inside the offboard dialog')
              .toBe(true);
            await expectNoRawI18nKeys(page, 'offboard dialog');
            await shot('offboard-dialog');

            await page.getByRole('button', { name: 'Remove', exact: true }).click();
            await expect(
              page.getByText(`${associate.account.email} has been removed.`),
            ).toBeVisible();
            // The associate's ROW is gone (the toast may still name them).
            await expect(
              page.getByRole('row', { name: new RegExp(associate.account.email) }),
            ).toHaveCount(0);
            await shot('members-after-offboard');
          });
        } finally {
          await associate.api.dispose();
        }
      } else {
        test.info().annotations.push({
          type: 'blocker',
          description:
            'Admin tabs unreachable — billing, policies, invite UI, members and ' +
            'offboard steps could NOT be walked this round.',
        });
        // Billing still gets activated so the rest of the journey (workspace
        // switching, org project attribution) stays representative.
        await upsertOrgBilling(orgId, { planType: 'payg', seats: 1 });
      }

      // ------------------------------------------------------------------
      await test.step('workspace switcher: visible, labelled, keyboard-safe', async () => {
        await page.goto('/');
        const trigger = page.getByTestId('workspace-switcher-trigger');
        await expect(trigger).toBeVisible();
        await expect(trigger).toHaveAttribute(
          'aria-label',
          'Switch workspace. Current workspace: Personal',
        );
        await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');

        await trigger.click();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        // Billing context is stated at the exact moment of switching.
        await expect(
          page.getByRole('menuitem', { name: /Personal.*Billed to you/s }),
        ).toBeVisible();
        const orgItem = page.getByRole('menuitem', {
          name: new RegExp(`${ORG_NAME}.*Billed to ${ORG_NAME}`, 's'),
        });
        await expect(orgItem).toBeVisible();
        await shot('workspace-switcher-open');

        await orgItem.click();
        await expect(trigger).toContainText(ORG_NAME);
        await expectNoRawI18nKeys(page, 'sidebar in org workspace');
        await shot('org-workspace-active');
      });

      // ------------------------------------------------------------------
      await test.step('org-owned project creation in the org workspace', async () => {
        await page.goto('/account/projects');
        await expect(
          page.getByRole('heading', { name: 'Projects', exact: true }),
        ).toBeVisible();

        await page.getByLabel('Project name').fill('Client memos');
        await page.getByRole('button', { name: 'Create project' }).click();
        // The service navigates to the new project's detail page on success.
        await expect(page).toHaveURL(/\/account\/projects\/.+/, { timeout: 15_000 });
        const projectId = page.url().split('/').pop()!;
        await shot('project-created-in-org-workspace');

        // The project created while the ORG workspace is active must be
        // org-owned — otherwise it silently lands in (and bills) Personal,
        // which is exactly Sophie's/Nils's context-confusion friction.
        const rec = await sophieApi.api.get(`/api/v1/projects/${projectId}`);
        expect(rec.ok()).toBe(true);
        const project = (await rec.json()) as { organisation?: string };
        expect
          .soft(
            project.organisation,
            'project created in org workspace must carry the organisation',
          )
          .toBe(orgId);

        // And it must be visible in the org workspace's project list.
        await page.goto('/account/projects');
        await expect
          .soft(
            page.getByText('Client memos', { exact: true }),
            'org workspace project list shows the project just created there',
          )
          .toBeVisible();
        await shot('org-workspace-projects-list');
      });

      // ------------------------------------------------------------------
      await test.step('audit surface', async () => {
        // Backend org_audit_events shipped, but team settings exposes no
        // audit tab yet — recorded as a skip note, not a failure.
        await page.goto('/account/team');
        const tabsVisible = await adminTabs
          .waitFor({ state: 'visible', timeout: 5_000 })
          .then(
            () => true,
            () => false,
          );
        const hasAuditTab = tabsVisible
          ? await adminTabs.getByRole('button', { name: /audit/i }).count()
          : 0;
        test.info().annotations.push({
          type: 'note',
          description:
            hasAuditTab === 0
              ? 'No audit UI in team settings — backend org_audit_events exists; UI skipped.'
              : 'Audit tab present — extend walkthrough to cover it.',
        });
        await shot('team-settings-final');
      });
    } finally {
      await sophieApi.api.dispose();
    }
  });
});
