import { expect, test } from '@playwright/test';

import {
  buildUserMemoryRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const PB = 'http://localhost:8090';

// The settings Memory page shows the user's personal (user-scoped) memory, lets
// them edit it, and persists only re-encrypted ciphertext — sensitive values are
// re-redacted before storage so no plaintext PII is ever written.
test('views and edits user memory, persisting re-encrypted ciphertext', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_acc_mem', 'accmem@example.com');
  const memory = buildUserMemoryRecordFixture(userFixture, {
    id: 'um_e2e',
    created: '2026-06-13T22:25:10Z',
    durableMemory: {
      items: ['Prefers TypeScript', 'Use pnpm'],
    },
  });

  let patchedData: string | undefined;
  let redactionEntries: unknown;
  let preferencesData: string | undefined;
  const preferencesRecord = () => ({
    id: 'up_memory_e2e',
    user: userFixture.authState.model.id,
    data: preferencesData,
  });

  await seedAuthenticatedUnlockState(page, userFixture);
  await page.route(`${PB}/api/v1/user-key-pair`, (r) =>
    r.fulfill({ json: userFixture.userKeyPairRecord }),
  );
  await page.route(`${PB}/api/v1/vault-session`, (r) =>
    r.fulfill({ json: userFixture.vaultSession }),
  );
  await page.route(`${PB}/api/v1/user-preferences`, (r) => {
    if (r.request().method() === 'POST') {
      preferencesData = (r.request().postDataJSON() as { data: string }).data;
      return r.fulfill({ json: preferencesRecord() });
    }
    return preferencesData
      ? r.fulfill({ json: preferencesRecord() })
      : r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.route(`${PB}/api/v1/user-preferences/up_memory_e2e`, (r) => {
    preferencesData = (r.request().postDataJSON() as { data: string }).data;
    return r.fulfill({ json: preferencesRecord() });
  });
  await page.route(`${PB}/api/v1/billing`, (r) =>
    r.fulfill({
      json: { plan_type: 'trial', status: 'trial', balance_chf: 2, trial_seed_chf: 2 },
    }),
  );
  await page.route(`${PB}/api/v1/billing/usage`, (r) =>
    r.fulfill({
      json: { period_start: '2026-06-01T00:00:00Z', message_count: 0, by_model: [] },
    }),
  );
  await page.route(`${PB}/api/v1/conversations`, (r) => r.fulfill({ json: [] }));
  await page.route(`${PB}/api/v1/user-memory`, (r) =>
    r.fulfill({ json: { items: [memory] } }),
  );
  await page.route(`${PB}/api/v1/user-memory/um_e2e`, (r) => {
    patchedData = (r.request().postDataJSON() as { data?: string }).data;
    return r.fulfill({
      json: {
        id: 'um_e2e',
        user: userFixture.authState.model.id,
        data: patchedData,
        created: '2026-06-13T22:25:10Z',
        updated: '2026-06-13T22:40:00Z',
      },
    });
  });
  await page.route(`${PB}/api/v1/user-redaction-entries`, (r) => {
    if (r.request().method() === 'POST') {
      redactionEntries = (r.request().postDataJSON() as { entries: unknown }).entries;
      return r.fulfill({ json: { items: [] } });
    }
    return r.fulfill({ json: { items: [] } });
  });

  // The settings nav surfaces the Memory entry.
  await page.goto('/account');
  await expect(page.getByRole('link', { name: 'Memory' })).toBeVisible();
  await page.getByRole('switch', { name: 'Use personal memory' }).click();
  await expect(page.getByText(/Memory is on/)).toBeVisible();

  await page.goto('/account/memory');
  await expect(page.getByRole('heading', { name: 'Your memory' })).toBeVisible();

  // The stored, decrypted user memory is shown as a single list.
  const items = page.locator('#user-memory-items');
  await expect(items).toHaveValue('Prefers TypeScript\nUse pnpm');

  // Typing a sensitive value flags exactly what will be stored redacted.
  await items.fill('Prefers TypeScript\nUse pnpm\nEmail ewan@climacrux.com');
  const redactedNote = page.locator('.memory-page__redacted-note').first();
  await expect(redactedNote).toBeVisible();
  await expect(redactedNote.locator('mark')).toHaveText('ewan@climacrux.com');

  // Edit and save.
  await items.fill(
    'Prefers TypeScript\nUse pnpm\nDeploys on Infomaniak\nEmail ewan@climacrux.com',
  );
  await page.getByRole('button', { name: 'Save' }).click();

  // A re-encrypted (ciphertext) PATCH was sent — never the edited plaintext, and
  // the email was re-redacted into a user-scope entry.
  await expect.poll(() => patchedData).toBeTruthy();
  expect(patchedData).not.toContain('Infomaniak');
  expect(patchedData).not.toContain('TypeScript');
  expect(patchedData).not.toContain('ewan@climacrux.com');
  expect(JSON.stringify(redactionEntries)).not.toContain('ewan@climacrux.com');
});
