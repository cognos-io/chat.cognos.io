import { Page, expect, test } from '@playwright/test';

import {
  apiLogin,
  composer,
  expectNoRawI18nKeys,
  makeShooter,
  provisionUnlockedAccount,
  setUserBillingBalance,
} from './persona-helpers';

// PERSONA WALKTHROUGH — Thomas Berner (PER-002), solo employment lawyer.
// Thomas pastes client email into Completions with Redaction `better` and
// privacy tier `ch_only`, verifies placeholders reach the provider (never raw
// PII), bookmarks clause wording, searches by matter codename, and inspects
// the public-share dialog (not a participant invite). Trial exhaustion is
// seeded via the e2e superuser when the stack allows it.

const CLIENT_AHV = '756.9217.0769.85';
const CLIENT_IBAN = 'CH93 0076 2011 6238 5295 7';
const CLIENT_EMAIL = 'anna.mueller.client@example.com';
const MATTER_CODENAME = 'NEBULA-SETTLEMENT';
const SETTLEMENT_CLAUSE =
  'The employer shall pay twelve months salary as severance under matter NEBULA-SETTLEMENT.';

const CLIENT_EMAIL_BODY = `From: ${CLIENT_EMAIL}
Subject: Termination package — matter ${MATTER_CODENAME}

Dear Thomas,

Please draft a settlement letter. My AHV number is ${CLIENT_AHV} and my salary
account is ${CLIENT_IBAN}.

Regards,
Anna Müller`;

function messageText(page: Page, text: string) {
  return page.locator('app-message-list').getByText(text, { exact: true }).first();
}

// Triple-click selects the whole paragraph and fires REAL pointer events, so
// Angular's mouseup HostListener runs inside the zone and the popover appears.
async function selectMessageText(page: Page, content: string): Promise<void> {
  const markdown = page
    .locator('app-message-list app-redacted-markdown', { hasText: content })
    .first();
  await markdown.scrollIntoViewIfNeeded();
  await markdown.click({ clickCount: 3 });
}

async function selectComposerModel(page: Page, displayName: RegExp): Promise<void> {
  const form = page.locator('.message-form');
  if (await form.getByRole('button', { name: displayName }).isVisible()) {
    return;
  }
  await form
    .getByRole('button', { name: /Qwen|Llama|GPT|Gemini|Claude|Mistral/i })
    .first()
    .click();
  const selector = page.getByRole('listbox', { name: /pick your ai model/i });
  await expect(selector).toBeVisible();
  await selector.getByRole('option', { name: displayName }).first().click();
  await expect(form.getByRole('button', { name: displayName }).first()).toBeVisible();
}

test.describe('persona walkthrough: Thomas — solo employment lawyer', () => {
  test('redaction → completion → bookmark → search → share vs participant → trial gate', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const shot = makeShooter(page, 'thomas');

    const { account } = await test.step('signup + vault setup', async () => {
      const created = await provisionUnlockedAccount(page);
      await shot('signed-up-home');
      return created;
    });

    await test.step('lock Redaction to better and privacy tier to Switzerland only', async () => {
      await page.goto('/account');
      await page.getByLabel('Detection').selectOption('better');
      await expect(page.getByLabel('Detection')).toHaveValue('better');

      const swissTier = page.getByRole('radio', { name: 'Switzerland only' });
      await expect(swissTier).toBeVisible();
      await swissTier.click();
      await expect(swissTier).toHaveAttribute('aria-checked', 'true');
      await expect(
        page.getByText('Switzerland only', { exact: true }).first(),
      ).toBeVisible();
      await expectNoRawI18nKeys(page, 'account settings (redaction + tier)');
      await shot('account-better-ch-only');
      await page.goto('/');

      // ch_only can auto-select a model the e2e mock cannot serve — pick Llama 3.3
      // (Infomaniak / Switzerland) which the mock handles reliably.
      await selectComposerModel(page, /Llama 3\.3/i);
      await shot('composer-llama-ch-only');
    });

    let sentMessages: Array<{ content?: string }> | undefined;
    await test.step('paste client email — redaction preview counts sensitive values', async () => {
      await page.route('**/complete', async (route) => {
        if (route.request().method() === 'POST') {
          const body = route.request().postDataJSON() as {
            messages?: Array<{ content?: string }>;
          };
          sentMessages = body.messages;
        }
        await route.continue();
      });

      const prompt = `Draft a settlement letter opening from this client email:\n\n${CLIENT_EMAIL_BODY}`;
      await composer(page).fill(prompt);

      const redactionSummary = page.locator('.message-form__redaction-summary');
      await expect(redactionSummary).toContainText(/Redacting \d+ sensitive value/);
      await shot('composer-redaction-preview-count');

      await redactionSummary.click();
      const previewList = page.locator('.message-form__redaction-list');
      await expect(previewList).toBeVisible();

      // Friction #1: Thomas skims the preview before send. Types surface on the
      // redaction pill buttons' accessible names, not as bare list labels.
      const ahvListed = await previewList
        .getByRole('button', { name: /AHV number/i })
        .isVisible();
      expect
        .soft(
          ahvListed,
          'friction #1: AHV should appear in the redaction preview before send',
        )
        .toBe(true);
      if (!ahvListed) {
        test.info().annotations.push({
          type: 'friction',
          description:
            'AHV not listed in redaction preview — Thomas would miss it until skimming (PER-002 friction #1).',
        });
      }

      await expect(previewList.getByRole('button', { name: /IBAN/i })).toBeVisible();
      await expect(
        previewList.getByRole('button', { name: /Email address/i }),
      ).toBeVisible();
    });

    await test.step('send → provider receives placeholders, not raw PII', async () => {
      await page.getByRole('button', { name: /^send$/i }).click();
      await expect(page.getByText('Mocked assistant reply')).toBeVisible({
        timeout: 30_000,
      });

      // Habit card can steal pointer events from the selection popover.
      const habitDismiss = page.getByRole('button', { name: 'Hide these suggestions' });
      if (await habitDismiss.isVisible()) {
        await habitDismiss.click();
      }

      const content = sentMessages?.at(-1)?.content ?? '';
      expect(content).not.toContain(CLIENT_EMAIL);
      expect(content).not.toContain(CLIENT_AHV.replace(/\./g, ''));
      expect(content).not.toContain('CH9300762011623852957');
      expect(content).toMatch(/\[\[PII_EMAIL_[A-Z0-9]+\]\]/);
      expect(content).toMatch(/\[\[PII_IBAN_[A-Z0-9]+\]\]/);
      await shot('assistant-reply-encrypted');
    });

    await test.step('usage / trial credit visible after the turn', async () => {
      await expect
        .soft(page.getByText(/CHF .* left of your CHF .* trial/))
        .toBeVisible({ timeout: 15_000 });
      await shot('trial-credit-after-send');
    });

    await test.step('bookmark a clause from the assistant reply', async () => {
      // The default mock reply is too short to anchor reliably — echo a settlement
      // clause so Thomas can pin wording from the assistant turn.
      await composer(page).fill(`[echo] ${SETTLEMENT_CLAUSE}`);
      await page.getByRole('button', { name: /^send$/i }).click();
      await expect(messageText(page, SETTLEMENT_CLAUSE)).toBeVisible({
        timeout: 30_000,
      });

      await selectMessageText(page, 'twelve months salary as severance');
      await expect(
        page.getByRole('button', { name: /save to bookmarks/i }),
      ).toBeVisible({
        timeout: 10_000,
      });
      await page.getByRole('button', { name: /save to bookmarks/i }).click();
      await expect(page.getByText('Saved to bookmarks')).toBeVisible();

      await page.goto('/account/bookmarks');
      await expect(page.getByText('twelve months salary as severance')).toBeVisible();
      await shot('bookmarks-list');
    });

    await test.step('on-device search finds the matter by codename', async () => {
      await page.goto('/');
      const search = page.getByPlaceholder('Search', { exact: true });
      await search.fill(MATTER_CODENAME);
      await expect(page.getByText('Search results', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Mocked conversation title' }),
      ).toBeVisible();
      await expect(
        page.getByText('Searched on this device', { exact: true }),
      ).toBeVisible();
      await shot('search-by-codename');
    });

    await test.step('share dialog: public link + redacted mode — not “add participant”', async () => {
      await page
        .getByRole('link', { name: 'Mocked conversation title' })
        .first()
        .click();
      await expect(page).toHaveURL(/\/c\//);

      // Friction #2: the Share affordance uses a user-plus icon — easy to confuse
      // with inviting a paralegal as a Participant.
      const shareButton = page.getByRole('button', { name: 'Share' });
      await expect(shareButton).toBeVisible();
      await shareButton.click();

      const dialog = page.getByRole('dialog', { name: 'Share conversation' });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByText(
          'Anyone with this link can open and read this conversation — every message, past and future — until you stop sharing.',
        ),
      ).toBeVisible();
      await expect(dialog.getByText('Share redacted conversation only')).toBeVisible();
      await expect(dialog.getByText('Recommended', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Include sensitive values')).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: 'Create public link' }),
      ).toBeVisible();

      const dialogText = await dialog.innerText();
      expect
        .soft(dialogText, 'public share must not look like a participant invite')
        .not.toMatch(/\b(participant|Editor|Viewer|Admin)\b/i);
      await expectNoRawI18nKeys(page, 'share dialog');
      await shot('share-dialog-public-not-participant');

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    const thomasApi = await apiLogin(account);
    try {
      await test.step('trial credit exhausted → send blocked with clear copy', async () => {
        // Drain credit to zero via superuser (no Paddle in e2e).
        await setUserBillingBalance(thomasApi.userId, 0);

        const billingLoaded = page.waitForResponse(
          (res) => res.url().includes('/api/v1/billing') && res.ok(),
        );
        await page.reload();
        await billingLoaded;

        await expect(page.getByText('Your trial credits are used up')).toBeVisible({
          timeout: 15_000,
        });
        await expect(page.getByText('Sending is paused')).toBeVisible();
        await expect(
          page.getByText(
            'Your chats stay encrypted and readable. Choose a plan to start sending again.',
          ),
        ).toBeVisible();
        await expect(page.getByText('Used up', { exact: true })).toBeVisible();

        const composerInput = composer(page);
        const followUp = 'Urgent settlement follow-up before the client deadline';

        if (await composerInput.isVisible()) {
          await composerInput.fill(followUp);
          await page.getByRole('button', { name: /^send$/i }).click();
          await expect(messageText(page, followUp)).toHaveCount(0);
          expect.soft(await composerInput.inputValue()).toBe(followUp);
        } else {
          test.info().annotations.push({
            type: 'friction',
            description:
              'PER-002 friction #3: zero-balance reload locks the composer before send — draft preservation applies on mid-send 402 only.',
          });
        }

        await expectNoRawI18nKeys(page, 'trial exhausted gate');
        await shot('trial-exhausted-gate');
      });
    } finally {
      await thomasApi.api.dispose();
    }

    await test.step('design gate: no raw i18n keys on home', async () => {
      await page.goto('/');
      await expectNoRawI18nKeys(page, 'home after walkthrough');
      await shot('walkthrough-complete');
    });
  });

  test('branch: turning redaction off surfaces an explicit account warning', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await provisionUnlockedAccount(page);

    await page.goto('/account');
    await page.getByLabel('Detection').selectOption('off');
    await expect(page.getByLabel('Detection')).toHaveValue('off');
    await expect(
      page.getByText(
        'Redaction is off. New messages you send will include sensitive values in full. Conversations you already redacted stay protected.',
      ),
    ).toBeVisible();
    await expectNoRawI18nKeys(page, 'redaction disabled warning');
  });

  test('branch: bookmark jump returns to the saved clause in the thread', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await provisionUnlockedAccount(page);

    await composer(page).fill(`[echo] ${SETTLEMENT_CLAUSE}`);
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(messageText(page, SETTLEMENT_CLAUSE)).toBeVisible({ timeout: 30_000 });

    await selectMessageText(page, 'twelve months salary as severance');
    await page.getByRole('button', { name: /save to bookmarks/i }).click();
    await expect(page.getByText('Saved to bookmarks')).toBeVisible();

    await page.goto('/account/bookmarks');
    await page.getByRole('button', { name: /^jump$/i }).click();
    await expect(page).toHaveURL(/\/c\//);
    const bookmarkedClause = page
      .locator('app-message-list cog-assistant-message')
      .getByText('twelve months salary as severance')
      .first();
    await expect(bookmarkedClause).toBeVisible({ timeout: 15_000 });
    await expect(bookmarkedClause).toBeInViewport();
  });

  test('branch: include-sensitive public share shows higher-risk live status', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await provisionUnlockedAccount(page);

    const prompt = `Settlement terms for ${CLIENT_EMAIL} regarding ${MATTER_CODENAME}`;
    await composer(page).fill(prompt);
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText('Mocked assistant reply')).toBeVisible({
      timeout: 30_000,
    });

    const habitDismiss = page.getByRole('button', { name: 'Hide these suggestions' });
    if (await habitDismiss.isVisible()) {
      await habitDismiss.click();
    }

    await page.getByRole('button', { name: 'Share' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share conversation' });
    await expect(dialog).toBeVisible();

    // Friction #2: Thomas must not casually pick include-sensitive — the UI
    // marks it higher risk before he creates the link.
    await dialog.getByLabel('Include sensitive values').check();
    await expect(dialog.getByText('Higher risk', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Create public link' }).click();

    await expect(
      dialog.getByText('Sharing with sensitive values restored'),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog.getByText('Live', { exact: true })).toBeVisible();
    await expectNoRawI18nKeys(page, 'include-sensitive share live');
  });
});
