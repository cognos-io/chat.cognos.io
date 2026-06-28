import { Page, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';

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

const TLS_CERT = process.env.E2E_TLS_CERT ?? '/tmp/cognos.crt';
const TLS_KEY = process.env.E2E_TLS_KEY ?? '/tmp/cognos.key';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
};

// A scripted assistant turn: the first token arrives immediately (so the
// streaming bubble appears), the rest and the terminating `complete` event
// arrive later — after the conversation record would have been PATCHed.
interface ScriptedReply {
  firstDelta: string;
  restDelta: string;
  response: unknown;
}

function completeEvent(reply: ScriptedReply): string {
  return `data: ${JSON.stringify({ type: 'complete', response: reply.response })}\n\n`;
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

// Reproduces the first-message streaming abort on a *new* conversation, and
// guards that the surrounding multi-turn flow keeps working.
//
// Sending the first message creates the conversation, then runs two requests
// concurrently: title generation (POST /completions, persist:false) and the
// real answer (POST /conversations/:id/complete, SSE). When the title comes
// back the frontend PATCHes the conversation record, which swaps the
// conversation object held by the `conversation$` signal for a freshly-decrypted
// one, making the signal re-emit. The message-loading subscriber reacts to
// *any* re-emit and unconditionally calls abortActiveCompletion(), killing the
// in-flight /complete stream mid-way (the NS_BINDING_ABORTED seen in the
// browser). The reply never finalises.
//
// We slow each answer stream so the title PATCH always lands before the first
// turn's `complete` event arrives, making the race deterministic. The real
// backend still handles conversation creation, the title /completions call and
// the title PATCH — only the /complete SSE body is served by the local server.
//
// The second turn is a regression guard: a follow-on message in the same
// conversation must still stream to completion and must not wipe the earlier
// turn from the thread.
test('streaming survives the concurrent title update across multiple turns', async ({
  page,
}) => {
  const replies: ScriptedReply[] = [
    {
      firstDelta: 'Hello',
      restDelta: ' from the slow stream',
      response: {
        user_message_id: 'msg_user_slow_1',
        assistant_message: {
          id: 'msg_assistant_slow_1',
          parent_message_id: 'msg_user_slow_1',
          content: 'Hello from the slow stream',
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
      },
    },
    {
      firstDelta: 'Second',
      restDelta: ' slow reply',
      response: {
        user_message_id: 'msg_user_slow_2',
        assistant_message: {
          id: 'msg_assistant_slow_2',
          // Threads under the first turn so the active branch keeps both turns.
          parent_message_id: 'msg_user_slow_2',
          content: 'Second slow reply',
          persona_id: 'cognos:simple-assistant',
          model_id: 'eu-model',
          created_at: '2026-06-27T00:01:00Z',
        },
        usage: {
          input_tokens: 18,
          output_tokens: 6,
          total_tokens: 24,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cost_usd: 0.02,
          cost_chf: 0.02,
          cost_rappen: 2,
          used_provider_cost: true,
        },
      },
    },
  ];

  let nextReply = 0;

  const server = createServer(
    { cert: readFileSync(TLS_CERT), key: readFileSync(TLS_KEY) },
    (request, response) => {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, corsHeaders);
        response.end();
        return;
      }

      const reply = replies[Math.min(nextReply, replies.length - 1)];
      nextReply += 1;

      response.writeHead(200, {
        ...corsHeaders,
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'content-type': 'text/event-stream',
      });
      response.flushHeaders();

      // First token — arrives before the title round-trip, so the streaming
      // placeholder becomes visible.
      response.write(
        `data: ${JSON.stringify({ type: 'delta', delta: reply.firstDelta })}\n\n`,
      );

      // Remaining tokens + completion arrive after the title PATCH would land.
      setTimeout(() => {
        response.write(
          `data: ${JSON.stringify({ type: 'delta', delta: reply.restDelta })}\n\n`,
        );

        setTimeout(() => {
          response.end(completeEvent(reply));
        }, 1200);
      }, 1200);
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine mock stream server address.');
  }

  const composerLabel =
    'Message Cognos — stored encrypted; sent to your provider to reply';

  try {
    await provisionUnlockedAccount(page);

    // Serve the answer stream slowly. Everything else (conversation creation,
    // the title /completions call, the title PATCH) still hits the real backend.
    await page.route('**/api/v1/conversations/*/complete', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.continue({ url: `https://127.0.0.1:${address.port}/stream` });
    });

    // --- Turn 1: first message on a brand-new conversation (the race) ---
    await page.getByLabel(composerLabel).fill('Trigger the title race');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByText('Trigger the title race')).toBeVisible();

    // The streaming bubble (first token) appears.
    const streamingAssistantMessage = page
      .locator('.message-list-item__streaming')
      .last();
    await expect(streamingAssistantMessage).toBeVisible();
    await expect(streamingAssistantMessage).toContainText('Hello');

    // The stream must finish and finalise into a rendered assistant message.
    // With the bug, the concurrent title PATCH aborts the /complete stream
    // before the `complete` event arrives, so it never finalises and this
    // assertion times out.
    const assistantMessages = page.locator('.message-list-item__assistant markdown p');
    await expect(assistantMessages.last()).toHaveText('Hello from the slow stream');

    // --- Turn 2: follow-on message in the same conversation (regression) ---
    await page.getByLabel(composerLabel).fill('And a follow-up question');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByText('And a follow-up question')).toBeVisible();
    await expect(assistantMessages.last()).toHaveText('Second slow reply');

    // The earlier turn must survive — the follow-on send must not reload/wipe
    // the thread.
    await expect(assistantMessages).toHaveCount(2);
    await expect(page.getByText('Hello from the slow stream')).toBeVisible();
    await expect(page.getByText('Trigger the title race')).toBeVisible();
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
