import { Page, expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildMessageRecordFixture,
  buildPublicShareFixture,
  buildVaultFixture,
} from './fixtures';

const PB = 'http://localhost:8090';

const IBAN = 'GB82 WEST 1234 5698 7654 32';
const TOKEN = '[[PII_IBAN_PUB001]]';

const routePublic = async (
  page: Page,
  token: string,
  publicConversationResponse: object,
  messages: object[],
  redactionEntriesResponse: object | null,
) => {
  await page.route(`${PB}/api/v1/public/conversations/${token}`, (route) =>
    route.fulfill({ json: publicConversationResponse }),
  );
  await page.route(`${PB}/api/v1/public/conversations/${token}/messages`, (route) =>
    route.fulfill({
      json: {
        page: 1,
        perPage: 100,
        totalItems: messages.length,
        totalPages: 1,
        items: messages,
      },
    }),
  );
  await page.route(`${PB}/api/v1/public/models`, (route) =>
    route.fulfill({ json: { models: [{ id: 'eu-model', name: 'EU Model' }] } }),
  );
  // Redacted-only shares 404 here (server-gated); include-sensitive return data.
  await page.route(
    `${PB}/api/v1/public/conversations/${token}/redaction-entries`,
    (route) =>
      redactionEntriesResponse
        ? route.fulfill({ json: redactionEntriesResponse })
        : route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: '{}',
          }),
  );
};

test.use({ viewport: { width: 1280, height: 720 } });

test('include-sensitive share: reader sees placeholders, then reveals on opt-in', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_pub_inc', 'pub@example.com');
  const conversation = buildConversationFixture(userFixture, 'conv_pub_inc', 'Payment');
  const share = buildPublicShareFixture(conversation, 'inctoken00000001', {
    redactionEntries: [
      {
        token: TOKEN,
        type: 'iban',
        original: IBAN,
        normalized: 'GB82WEST12345698765432',
        detector: 'iban:v1',
      },
    ],
  });

  const message = buildMessageRecordFixture(conversation, {
    id: 'm_pub_inc',
    created: '2026-06-14T10:00:00Z',
    content: `Please transfer to ${TOKEN} today`,
    ownerId: userFixture.authState.model.id,
  });

  await routePublic(
    page,
    share.token,
    share.publicConversationResponse,
    [message],
    share.redactionEntriesResponse,
  );

  await page.goto(`/p/${share.token}#${share.fragment}`);

  await expect(page.getByRole('heading', { name: 'Payment' })).toBeVisible();

  const messages = page.locator('.public-conversation__messages');
  // Default: the sensitive value is NOT shown; a neutral marker stands in.
  await expect(messages).not.toContainText('GB82');
  await expect(messages).toContainText('redacted');
  // The raw token is never shown either.
  await expect(messages).not.toContainText('[[PII_');

  // The opt-in control is offered because the sharer included sensitive values.
  const reveal = page.getByRole('button', {
    name: 'Include potentially sensitive values',
  });
  await expect(reveal).toBeVisible();

  await reveal.click();

  // Now the original is visible.
  await expect(messages).toContainText(IBAN);
  await expect(messages).not.toContainText('redacted');

  // And it can be hidden again.
  await page.getByRole('button', { name: 'Hide sensitive values' }).click();
  await expect(messages).not.toContainText('GB82');
});

test('redacted-only share: reader can never reveal sensitive values', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_pub_red', 'pub@example.com');
  const conversation = buildConversationFixture(userFixture, 'conv_pub_red', 'Payment');
  // No redactionEntries → redacted-only share (no key material in the URL).
  const share = buildPublicShareFixture(conversation, 'redtoken00000001');

  const message = buildMessageRecordFixture(conversation, {
    id: 'm_pub_red',
    created: '2026-06-14T10:00:00Z',
    content: `Please transfer to ${TOKEN} today`,
    ownerId: userFixture.authState.model.id,
  });

  // The mappings endpoint is gated server-side; model the 404 (null response).
  await routePublic(
    page,
    share.token,
    share.publicConversationResponse,
    [message],
    null,
  );

  await page.goto(`/p/${share.token}#${share.fragment}`);

  await expect(page.getByRole('heading', { name: 'Payment' })).toBeVisible();

  const messages = page.locator('.public-conversation__messages');
  await expect(messages).toContainText('redacted');
  await expect(messages).not.toContainText('GB82');
  await expect(messages).not.toContainText('[[PII_');

  // No opt-in is offered — the sharer chose redacted-only, so the value is
  // simply not available to this reader.
  await expect(
    page.getByRole('button', { name: 'Include potentially sensitive values' }),
  ).toHaveCount(0);
});
