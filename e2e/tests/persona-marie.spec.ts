import { expect, test } from '@playwright/test';

import {
  apiLogin,
  composer,
  expectNoRawI18nKeys,
  makeShooter,
  provisionUnlockedAccount,
} from './persona-helpers';

// PERSONA WALKTHROUGH — Marie Keller (PER-001), privacy-conscious individual.
// Marie signs up, uses the first-value starter (prefill only), sends her first
// private Message, dismisses the habit nudge forever, sets Switzerland-only data
// processing, and explores disappearing messages plus temporary conversation
// mode — the controls she relies on instead of re-reading trust copy every
// evening. Non-blocking UX checks use expect.soft so one broken step still
// leaves the rest of the journey inspected (the test still fails).

test.describe('persona walkthrough: Marie — privacy-conscious individual', () => {
  test('signup → first-value starter → habit → ch_only → disappearing + temporary chat', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const shot = makeShooter(page, 'marie');
    const apiPaths: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) {
        apiPaths.push(url.pathname);
      }
    });

    const STARTER_PROMPT =
      'Help me think through a decision. Ask me one question at a time, and do not assume details I have not shared.';

    // ------------------------------------------------------------------
    const { account } = await test.step('signup + vault setup', async () => {
      const created = await provisionUnlockedAccount(page);
      await shot('signed-up-home');
      return created;
    });

    await test.step('first-value starter prefills the composer without sending', async () => {
      await expect(
        page.getByRole('heading', { name: 'What would you like to do first?' }),
      ).toBeVisible();

      // Friction #2: trust copy explains storage vs in-flight processing (not
      // "private AI means Cognos never sees my words").
      await expect
        .soft(
          page.getByText(
            /stored encrypted.*process the Messages in readable form during the request/i,
          ),
        )
        .toBeVisible();

      await page
        .getByRole('button', { name: /think through something privately/i })
        .click();

      await expect(composer(page)).toHaveValue(STARTER_PROMPT);
      expect(apiPaths).not.toContain('/api/v1/completions');
      await expectNoRawI18nKeys(page, 'first-value starter selected');
      await shot('starter-prefilled-not-sent');
    });

    // ------------------------------------------------------------------
    await test.step('send first private message → completion + recent conversation', async () => {
      await page.getByRole('button', { name: /^send$/i }).click();
      await expect(page.getByText('Mocked assistant reply')).toBeVisible({
        timeout: 30_000,
      });

      await expect(
        page.getByRole('link', { name: 'Mocked conversation title' }),
      ).toBeVisible();
      await expectNoRawI18nKeys(page, 'after first completion');
      await shot('first-message-recent-list');
    });

    await test.step('early habit card is visible after the first message', async () => {
      await expect(
        page.getByRole('heading', { name: 'Your first week with Cognos' }),
      ).toBeVisible();
      await expect(
        page.getByText(
          'A few gentle suggestions. Your Message content is never used to measure progress.',
        ),
      ).toBeVisible();
      await shot('habit-card-visible');
    });

    await test.step('dismiss habit card forever', async () => {
      await page.getByRole('button', { name: 'Hide these suggestions' }).click();
      await expect(
        page.getByRole('heading', { name: 'Your first week with Cognos' }),
      ).toBeHidden();

      await page.reload();
      await expect(page.getByRole('main')).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Your first week with Cognos' }),
      ).toBeHidden();
      await shot('habit-dismissed-forever');
    });

    // ------------------------------------------------------------------
    await test.step('set privacy tier to Switzerland only on account settings', async () => {
      await page.goto('/account#data-processing-heading');
      await expect(
        page.getByRole('heading', { name: 'Data processing' }),
      ).toBeVisible();

      const swissTier = page.getByRole('radio', { name: /Switzerland only/i });
      await expect(swissTier).toBeVisible();
      await swissTier.click();
      await expect(swissTier).toHaveAttribute('aria-checked', 'true');
      await expect(
        page.getByText('Switzerland only', { exact: true }).first(),
      ).toBeVisible();
      await expectNoRawI18nKeys(page, 'data processing ch_only');
      await shot('privacy-tier-ch-only');
    });

    // ------------------------------------------------------------------
    await test.step('new chat → enable disappearing messages (24 hours)', async () => {
      await page.goto('/');
      await page.getByRole('button', { name: /new chat/i }).click();
      await expect(page).toHaveURL(/\/$/);

      const disappearingButton = page.getByRole('button', {
        name: /Disappearing messages/i,
      });
      const disappearingAvailable = await disappearingButton.isVisible();
      expect
        .soft(
          disappearingAvailable,
          'BLOCKER: empty-state disappearing-messages control not reachable on new chat',
        )
        .toBe(true);

      if (disappearingAvailable) {
        await disappearingButton.click();
        await expect(
          page.getByRole('heading', { name: 'Disappearing messages' }),
        ).toBeVisible();
        await page.getByRole('button', { name: '24 hours' }).click();
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(disappearingButton).toContainText('24 hours');
        await shot('disappearing-messages-24h');
      } else {
        test.info().annotations.push({
          type: 'blocker',
          description:
            'Disappearing messages UI was not reachable — empty-state control missing or hidden.',
        });
        await shot('BLOCKER-disappearing-unreachable');
      }
    });

    await test.step('temporary conversation mode from empty-state toggle', async () => {
      await page.goto('/');
      await page.getByRole('button', { name: /new chat/i }).click();

      const temporarySwitch = page.getByRole('switch', { name: 'Temporary chat' });
      const temporaryAvailable = await temporarySwitch.isVisible();
      expect
        .soft(
          temporaryAvailable,
          'BLOCKER: temporary-chat toggle not reachable on empty chat',
        )
        .toBe(true);

      if (temporaryAvailable) {
        if ((await temporarySwitch.getAttribute('aria-checked')) !== 'true') {
          await temporarySwitch.click();
        }
        await expect(temporarySwitch).toHaveAttribute('aria-checked', 'true');
        // Header uses h1 "Temporary chat"; empty-state copy uses a div title.
        await expect(
          page.getByRole('heading', { name: 'Temporary chat' }),
        ).toBeVisible();
        await expect(
          page.getByText('Temporary conversation', { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(
            /Messages stay in this browser and are not saved as a Conversation/i,
          ),
        ).toBeVisible();
        await expectNoRawI18nKeys(page, 'temporary conversation mode');
        await shot('temporary-conversation-mode');
      } else {
        test.info().annotations.push({
          type: 'blocker',
          description:
            'Temporary conversation toggle was not reachable on the empty chat surface.',
        });
        await shot('BLOCKER-temporary-unreachable');
      }
    });

    // ------------------------------------------------------------------
    const marieApi = await apiLogin(account);
    try {
      await test.step('API: privacy tier persisted as ch_only on models catalogue', async () => {
        const res = await marieApi.api.get('/api/v1/models');
        expect(res.ok(), `models: ${res.status()} ${await res.text()}`).toBe(true);
        const body = (await res.json()) as { privacy_tier: string };
        expect
          .soft(
            body.privacy_tier,
            'BLOCKER: privacy_tier not ch_only after account settings change',
          )
          .toBe('ch_only');
        if (body.privacy_tier !== 'ch_only') {
          test.info().annotations.push({
            type: 'blocker',
            description: `Expected privacy_tier=ch_only from /api/v1/models; got ${body.privacy_tier}.`,
          });
        }
        await shot('api-privacy-tier-verified');
      });
    } finally {
      await marieApi.api.dispose();
    }
  });

  test('branch: temporary chat send does not persist a Conversation in Recent', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const shot = makeShooter(page, 'marie');
    const ephemeral = 'Marie therapy note — must not land in Recent';

    await provisionUnlockedAccount(page);
    await page.goto('/');
    await page.getByRole('button', { name: /new chat/i }).click();

    const temporarySwitch = page.getByRole('switch', { name: 'Temporary chat' });
    await expect(temporarySwitch).toBeVisible();
    if ((await temporarySwitch.getAttribute('aria-checked')) !== 'true') {
      await temporarySwitch.click();
    }
    await expect(page.getByRole('heading', { name: 'Temporary chat' })).toBeVisible();

    await composer(page).fill(ephemeral);
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText('Mocked assistant reply')).toBeVisible();
    await shot('temporary-reply-visible');

    await page.goto('/');
    await expect(page.getByRole('link', { name: ephemeral })).toHaveCount(0);
    await expect(page.getByText(ephemeral, { exact: true })).toHaveCount(0);
    await expectNoRawI18nKeys(page, 'home after temporary chat');
    await shot('temporary-not-in-recent');
  });

  test('branch: habit card starts another Conversation without auto-send', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const shot = makeShooter(page, 'marie');
    const apiPaths: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) apiPaths.push(url.pathname);
    });

    await provisionUnlockedAccount(page);
    await composer(page).fill('First journal entry for Marie');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText('Mocked assistant reply')).toBeVisible();

    await expect(
      page.getByRole('heading', { name: 'Your first week with Cognos' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Try another Conversation' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(composer(page)).toHaveValue('');
    expect(apiPaths.filter((path) => path === '/api/v1/completions')).toHaveLength(1);
    await expectNoRawI18nKeys(page, 'second conversation empty composer');
    await shot('habit-started-second-chat');
  });

  test('branch: after onboarding, security settings explain Emergency Kit recovery', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const shot = makeShooter(page, 'marie');

    await provisionUnlockedAccount(page);
    await page.goto('/account/security');

    await expect(
      page.getByRole('heading', { name: 'Account Key & Emergency Kit' }),
    ).toBeVisible();
    // Friction #1: once the ceremony is done, Marie cannot re-download here — the
    // copy must steer her back to the kit she saved at sign-up.
    await expect(
      page.getByText(
        'For your security we never keep a copy of your Account Key after you unlock.',
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Keep the Emergency Kit you saved when you signed up — it's the only way to unlock your data on a new device.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Download Emergency Kit' }),
    ).toHaveCount(0);
    await expectNoRawI18nKeys(page, 'security emergency kit guidance');
    await shot('emergency-kit-recovery-copy');
  });
});
