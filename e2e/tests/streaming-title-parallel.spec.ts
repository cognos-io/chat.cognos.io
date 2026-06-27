import { Page, expect, test } from '@playwright/test';
import { IncomingMessage, ServerResponse, createServer } from 'node:http';

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

// Sending the first message of a new conversation fans out into two
// independent upstream requests:
//   - title generation:  POST /api/v1/completions  (persist:false)
//   - the actual answer:  POST /api/v1/conversations/:id/complete  (SSE)
//
// Both must run to completion in parallel: the assistant reply renders AND the
// conversation is retitled. Neither may abort the other, and the outcome must
// not depend on which one finishes first (provider latency varies run to run).
//
// We drive both through a local server with controllable per-path delays so we
// can assert the requirement under both orderings. The title PATCH still hits
// the real backend (so the rename genuinely persists and re-decrypts).
function runParallelCompletionScenario(
  name: string,
  delays: { titleMs: number; mainMs: number },
): void {
  test(name, async ({ page }) => {
    const titleText = 'Generated parallel title';
    const replyText = 'Parallel answer body';

    // Each stream reports, server-side, whether the client tore the connection
    // down *before* the server finished sending it (i.e. aborted mid-flight).
    // This is the deterministic signal for the NS_BINDING_ABORTED symptom — a
    // browser-side fetch abort during the body is not surfaced as a Playwright
    // `requestfailed`, but the server always sees the early close.
    const streamState = {
      title: { settled: false, aborted: false },
      main: { settled: false, aborted: false },
    };

    // Send the SSE events, then hold the connection briefly before the trailing
    // close (as a real backend does between its `complete` event and [DONE]). If
    // the client tears down in that window, record it as a mid-flight abort.
    const sendThenHold = (
      response: ServerResponse,
      events: string[],
      track: { settled: boolean; aborted: boolean },
    ): void => {
      writeSseHeaders(response);
      for (const event of events) {
        response.write(event);
      }
      let finished = false;
      // Close the stream the way the backend does — by ending the response, with
      // no trailing sentinel (the cognos SSE format has no [DONE] line).
      const doneTimer = setTimeout(() => {
        finished = true;
        response.end();
        track.settled = true;
      }, 1500);
      response.on('close', () => {
        if (!finished) {
          clearTimeout(doneTimer);
          track.aborted = true;
          track.settled = true;
        }
      });
    };

    const server = createServer(
      (request: IncomingMessage, response: ServerResponse) => {
        if (request.method === 'OPTIONS') {
          response.writeHead(204, corsHeaders);
          response.end();
          return;
        }

        const url = new URL(request.url ?? '/', 'http://127.0.0.1');

        if (url.pathname === '/title') {
          setTimeout(() => {
            sendThenHold(
              response,
              [
                `data: ${JSON.stringify({
                  type: 'complete',
                  response: completionResponse(titleText, 'title'),
                })}\n\n`,
              ],
              streamState.title,
            );
          }, delays.titleMs);
          return;
        }

        if (url.pathname === '/main') {
          writeSseHeaders(response);
          // First token immediately so the streaming bubble appears.
          response.write(
            `data: ${JSON.stringify({ type: 'delta', delta: 'Parallel ' })}\n\n`,
          );
          let finished = false;
          const doneTimer = setTimeout(() => {
            response.write(
              `data: ${JSON.stringify({ type: 'delta', delta: 'answer body' })}\n\n`,
            );
            response.write(
              `data: ${JSON.stringify({
                type: 'complete',
                response: completionResponse(replyText, 'main'),
              })}\n\n`,
            );
            const endTimer = setTimeout(() => {
              finished = true;
              response.end();
              streamState.main.settled = true;
            }, 1500);
            response.on('close', () => clearTimeout(endTimer));
          }, delays.mainMs);
          response.on('close', () => {
            if (!finished) {
              clearTimeout(doneTimer);
              streamState.main.aborted = true;
              streamState.main.settled = true;
            }
          });
          return;
        }

        response.writeHead(404, { ...corsHeaders });
        response.end();
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

      await page
        .getByLabel('Message Cognos — stored encrypted; sent to your provider to reply')
        .fill('Kick off both streams');
      await page.getByRole('button', { name: /^send$/i }).click();

      await expect(page.getByText('Kick off both streams')).toBeVisible();

      // 1. The answer stream must finalise into a rendered assistant message.
      const finalAssistantMessage = page
        .locator('.message-list-item__assistant markdown p')
        .last();
      await expect(finalAssistantMessage).toHaveText(replyText);

      // 2. Title generation must also complete and persist: the conversation is
      //    renamed from "New Conversation" to the generated title.
      await expect(page.getByRole('link', { name: titleText })).toBeVisible();
      await expect(page.getByRole('link', { name: 'New Conversation' })).toHaveCount(0);

      // 3. Both upstream streams must terminate cleanly — neither may be torn
      //    down mid-flight (the NS_BINDING_ABORTED symptom).
      await expect.poll(() => streamState.title.settled).toBe(true);
      await expect.poll(() => streamState.main.settled).toBe(true);
      expect(streamState.main.aborted, 'answer stream aborted mid-flight').toBe(false);
      expect(streamState.title.aborted, 'title stream aborted mid-flight').toBe(false);
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
}

test.describe('first-message title generation and answer run in parallel', () => {
  // Title finishes first, while the answer is still streaming.
  runParallelCompletionScenario('title completes before the answer', {
    titleMs: 200,
    mainMs: 2500,
  });

  // Answer finishes first, while title generation is still in flight.
  runParallelCompletionScenario('answer completes before the title', {
    titleMs: 2500,
    mainMs: 200,
  });
});
