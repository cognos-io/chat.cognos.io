import { Page, expect, test } from '@playwright/test';
import { ServerResponse, createServer } from 'node:http';

import { makeTestAccount } from './fixtures';
import {
  acknowledgeAccountKey,
  captureGeneratedAccountKey,
  copyAccountKey,
  createEncryptedBackup,
  expectAccountKeyDialogForNewUser,
  fillRegisterForm,
  gotoRegister,
  submitRegister,
} from './helpers';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
};

function completionResponse(content: string, suffix: string): unknown {
  return {
    user_message_id: `msg_user_${suffix}`,
    assistant_message: {
      id: `msg_assistant_${suffix}`,
      parent_message_id: `msg_user_${suffix}`,
      content,
      persona_id: 'cognos:simple-assistant',
      model_id: 'eu-model',
      created_at: '2026-06-27T00:00:00Z',
    },
    usage: {
      input_tokens: 12,
      output_tokens: 8,
      total_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cost_usd: 0.02,
      cost_chf: 0.02,
      cost_rappen: 2,
      used_provider_cost: true,
    },
  };
}

function writeSseHeaders(response: ServerResponse): void {
  response.writeHead(200, {
    ...corsHeaders,
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  });
  response.flushHeaders();
}

async function provisionUnlockedAccount(page: Page) {
  const account = makeTestAccount();

  await gotoRegister(page);
  await fillRegisterForm(page, account);
  await submitRegister(page);

  await expectAccountKeyDialogForNewUser(page);

  const accountKey = await captureGeneratedAccountKey(page);
  await copyAccountKey(page);
  await acknowledgeAccountKey(page);
  await createEncryptedBackup(page);

  return { account, accountKey };
}

// Title generation runs alongside the first message's answer stream. The title
// flow ends in a PATCH of the conversation record. If that PATCH fails, the
// failure must NOT abort the user's answer stream — a best-effort title is
// independent of delivering the reply.
//
// Here the title /completions call succeeds (so the flow proceeds to the PATCH)
// but the conversation PATCH is forced to 500 while the answer is still
// streaming. The answer must still finalise.
test('a failed title update does not abort the answer stream', async ({ page }) => {
  const replyText = 'Answer that must survive a title failure';

  const server = createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/title') {
      writeSseHeaders(response);
      setTimeout(() => {
        response.end(
          `data: ${JSON.stringify({
            type: 'complete',
            response: completionResponse('Generated title', 'title'),
          })}\n\n`,
        );
      }, 150);
      return;
    }

    if (url.pathname === '/main') {
      writeSseHeaders(response);
      // First token immediately so the answer is visibly mid-stream when the
      // title PATCH fails.
      response.write(
        `data: ${JSON.stringify({ type: 'delta', delta: 'Answer ' })}\n\n`,
      );
      setTimeout(() => {
        response.end(
          `data: ${JSON.stringify({
            type: 'complete',
            response: completionResponse(replyText, 'main'),
          })}\n\n`,
        );
      }, 2000);
      return;
    }

    response.writeHead(404, { ...corsHeaders });
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine mock stream server address.');
  }
  const base = `http://127.0.0.1:${address.port}`;

  try {
    await provisionUnlockedAccount(page);

    await page.route('**/api/v1/completions', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.continue({ url: `${base}/title` });
    });

    await page.route('**/api/v1/conversations/*/complete', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.continue({ url: `${base}/main` });
    });

    // Force the title PATCH (the only PATCH to /conversations/:id) to fail.
    await page.route('**/api/v1/conversations/*', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Failed to update conversation.' }),
      });
    });

    await page
      .getByLabel('Message Cognos — stored encrypted; sent to your provider to reply')
      .fill('Reply despite a title failure');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByText('Reply despite a title failure')).toBeVisible();

    // The answer stream must finalise even though the title PATCH 500'd.
    const finalAssistantMessage = page
      .locator('.message-list-item__assistant markdown p')
      .last();
    await expect(finalAssistantMessage).toHaveText(replyText);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});
