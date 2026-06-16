import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

import {
  buildConversationFixture,
  buildMessageRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const API = 'http://localhost:8090';

test('the account page exports decrypted chats as a JSON download', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_exp01', 'export@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'convexport00001',
    'Exported chat',
  );
  const messageFixture = buildMessageRecordFixture(conversationFixture, {
    id: 'msgexport000001',
    created: '2026-06-01T10:00:00Z',
    content: 'Hello export world',
    ownerId: userFixture.authState.model.id,
  });

  await seedAuthenticatedUnlockState(page, userFixture);
  await page.route(`${API}/api/v1/user-key-pair`, (r) =>
    r.fulfill({ json: userFixture.userKeyPairRecord }),
  );
  await page.route(`${API}/api/v1/vault-session`, (r) =>
    r.fulfill({ json: userFixture.vaultSession }),
  );
  await page.route(`${API}/api/v1/user-preferences`, (r) =>
    r.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    }),
  );
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

  await page.route(`${API}/api/v1/conversations`, (r) =>
    r.fulfill({ json: [conversationFixture.conversationRecord] }),
  );
  await page.route(`${API}/api/v1/conversations/convexport00001/public-key`, (r) =>
    r.fulfill({ json: conversationFixture.conversationPublicKeyRecord }),
  );
  await page.route(`${API}/api/v1/conversations/convexport00001/secret-key`, (r) =>
    r.fulfill({ json: conversationFixture.conversationSecretKeyRecord }),
  );
  await page.route(
    `${API}/api/v1/conversations/convexport00001/messages?page=1&page_size=100`,
    (r) =>
      r.fulfill({
        json: {
          page: 1,
          perPage: 100,
          totalItems: 1,
          totalPages: 1,
          items: [messageFixture],
        },
      }),
  );

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/account');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  const download = await downloadPromise;

  const path = await download.path();
  const payload = JSON.parse(readFileSync(path, 'utf8'));

  expect(payload.conversation_count).toBe(1);
  expect(payload.conversations[0].title).toBe('Exported chat');
  expect(payload.conversations[0].messages[0]).toMatchObject({
    role: 'user',
    content: 'Hello export world',
  });
});
