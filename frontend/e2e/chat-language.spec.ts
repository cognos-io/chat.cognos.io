import { expect, test } from '@playwright/test';

import { buildVaultFixture, seedAuthenticatedUnlockState } from './fixtures';

const API = 'http://localhost:8090';

// Verifies the chat surface renders translated at runtime: with the language
// pre-set to German (as it would be after a prior choice), the logged-in chat
// shell comes up in German without any English fallback for converted strings.
test('chat shell renders in the pre-selected language (German)', async ({ page }) => {
  const fixture = buildVaultFixture('user_e2e_chatlang', 'chatlang@example.com');
  await seedAuthenticatedUnlockState(page, fixture);
  await page.addInitScript(() => localStorage.setItem('cognos:lang', 'de'));

  await page.route(`${API}/api/v1/user-key-pair`, (r) =>
    r.fulfill({ json: fixture.userKeyPairRecord }),
  );
  await page.route(`${API}/api/v1/vault-session`, (r) =>
    r.fulfill({ json: fixture.vaultSession }),
  );
  await page.route(`${API}/api/v1/user-preferences`, (r) =>
    r.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    }),
  );
  await page.route(`${API}/api/v1/conversations`, (r) => r.fulfill({ json: [] }));
  await page.route(`${API}/api/v1/models`, (r) =>
    r.fulfill({ json: { privacy_tier: 'eu', preferred_model_id: 'm', models: [] } }),
  );
  await page.route(`${API}/api/v1/billing`, (r) =>
    r.fulfill({
      json: { plan_type: 'trial', status: 'trial', balance_chf: 2, trial_seed_chf: 2 },
    }),
  );
  await page.route(`${API}/api/v1/billing/usage`, (r) =>
    r.fulfill({
      json: { period_start: '2026-06-01T00:00:00Z', message_count: 0, by_model: [] },
    }),
  );

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  // <html lang> reflects the active language, and the sidebar "New chat" control
  // is rendered in German (chat.list.newChat), with no English left over.
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('de');
  await expect(page.getByText('Neuer Chat').first()).toBeVisible();
  await expect(page.getByText('New chat')).toHaveCount(0);
});
