import { expect, test } from '@playwright/test';

import { buildVaultFixture } from './fixtures';

const API = 'http://localhost:8090';

// The unlock screen appears before the vault is decrypted, so its language
// picker can only persist locally. This proves switching language there both
// localises the dialog live and is remembered in localStorage.
test('the unlock dialog localises when the language is switched', async ({ page }) => {
  const fixture = buildVaultFixture('user_unlock_lang', 'unlock-lang@example.com');

  // Authenticated but NOT locally unlocked (no trusted vault session), so the
  // vault stays locked and the unlock gate opens the dialog.
  await page.addInitScript((authState) => {
    localStorage.setItem('pocketbase_auth', JSON.stringify(authState));
  }, fixture.authState);

  await page.route(`${API}/api/v1/user-key-pair`, (r) =>
    r.fulfill({ json: fixture.userKeyPairRecord }),
  );
  // No wrap key available — keeps the vault locked.
  await page.route(`${API}/api/v1/vault-session`, (r) =>
    r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
  await page.route(`${API}/api/v1/user-preferences`, (r) =>
    r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
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
  // Authenticated, so switching language also tries to persist to the account.
  await page.route(
    `${API}/api/collections/users/records/${fixture.authState.model.id}`,
    (r) => r.fulfill({ json: fixture.authState.model }),
  );

  await page.goto('/');

  // English by default.
  await expect(page.getByRole('heading', { name: 'Unlock backup' })).toBeVisible();
  await expect(
    page.getByText('Enter your Account Key to unlock this device.'),
  ).toBeVisible();

  // Switch to German from the picker in the dialog's title row.
  await page.getByRole('button', { name: 'Language' }).click();
  await page.getByRole('menuitem', { name: 'Deutsch' }).click();

  // Both the title and the body re-localise without closing the dialog.
  await expect(page.getByRole('heading', { name: 'Backup entsperren' })).toBeVisible();
  await expect(
    page.getByText(
      'Geben Sie Ihren Account-Schlüssel ein, um dieses Gerät zu entsperren.',
    ),
  ).toBeVisible();

  // The choice is remembered locally (it cannot be encrypted before unlock).
  expect(await page.evaluate(() => localStorage.getItem('cognos:lang'))).toBe('de');
});
