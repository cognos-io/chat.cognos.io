import { type Page, expect, test } from '@playwright/test';
import { type Server, createServer } from 'node:http';

import {
  type ConversationFixture,
  type MessageRecordFixture,
  type VaultFixture,
  buildConversationFixture,
  buildMessageRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
};

const modelsResponse = {
  privacy_tier: 'eu',
  preferred_model_id: 'eu-model',
  models: [
    {
      id: 'eu-model',
      name: 'EU Model',
      slug: 'eu-model',
      provider_id: 'infomaniak',
      provider_model_id: 'eu-model',
      description: 'Eligible model from the backend catalogue',
      privacy_tier: 'eu',
      tags: [{ title: 'switzerland' }],
      content_types: ['text'],
      input_context_tokens: 64000,
      max_output_tokens: 8192,
      pricing: {
        input_usd_per_million_tokens: 1,
        output_usd_per_million_tokens: 2,
      },
      is_eligible: true,
    },
  ],
};

type CompletionMockOptions = {
  conversationFixture: ConversationFixture;
  userFixture: VaultFixture;
  userPrompt: string;
  assistantContent: string;
  disconnectAfterFirstDelta?: boolean;
};

type CompletionMock = {
  server: Server;
  port: number;
  waitForPersisted: () => Promise<void>;
  getPersistedMessages: () => MessageRecordFixture[];
};

const listen = async (server: Server): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine mock stream server address.');
  }

  return address.port;
};

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const createCompletionMock = (options: CompletionMockOptions): CompletionMock => {
  const {
    conversationFixture,
    userFixture,
    userPrompt,
    assistantContent,
    disconnectAfterFirstDelta = false,
  } = options;

  let persistedMessages: MessageRecordFixture[] = [];
  let resolvePersisted: (() => void) | undefined;
  const persistedPromise = new Promise<void>((resolve) => {
    resolvePersisted = resolve;
  });

  const persistCompletedExchange = () => {
    const createdAt = '2026-06-07T00:00:00Z';
    const userMessage = buildMessageRecordFixture(conversationFixture, {
      id: `msg_user_${conversationFixture.conversationRecord.id}`,
      created: createdAt,
      content: userPrompt,
      ownerId: userFixture.authState.model.id,
    });
    const assistantMessage = buildMessageRecordFixture(conversationFixture, {
      id: `msg_assistant_${conversationFixture.conversationRecord.id}`,
      created: '2026-06-07T00:00:05Z',
      content: assistantContent,
      personaId: 'cognos:simple-assistant',
      modelId: 'eu-model',
      parentMessageId: userMessage.id,
    });

    persistedMessages = [userMessage, assistantMessage];
    resolvePersisted?.();
  };

  const server = createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'POST' || url.pathname !== '/stream') {
      response.writeHead(404, {
        ...corsHeaders,
        'content-type': 'application/json',
      });
      response.end(JSON.stringify({ message: 'Not found' }));
      return;
    }

    response.writeHead(200, {
      ...corsHeaders,
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream',
    });
    response.flushHeaders();

    response.write(`data: ${JSON.stringify({ type: 'delta', delta: 'Hi from ' })}\n\n`);

    setTimeout(() => {
      if (disconnectAfterFirstDelta) {
        response.destroy();
        setTimeout(() => {
          persistCompletedExchange();
        }, 100);
        return;
      }

      response.write(
        `data: ${JSON.stringify({ type: 'delta', delta: 'the streamed backend' })}\n\n`,
      );

      setTimeout(() => {
        response.end(
          `data: ${JSON.stringify({
            type: 'complete',
            response: {
              user_message_id: `msg_user_${conversationFixture.conversationRecord.id}`,
              assistant_message: {
                id: `msg_assistant_${conversationFixture.conversationRecord.id}`,
                parent_message_id: `msg_user_${conversationFixture.conversationRecord.id}`,
                content: assistantContent,
                persona_id: 'cognos:simple-assistant',
                model_id: 'eu-model',
                created_at: '2026-06-07T00:00:00Z',
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
          })}\n\n`,
        );
        persistCompletedExchange();
      }, 400);
    }, 250);
  });

  return {
    server,
    port: 0,
    waitForPersisted: async () => {
      await persistedPromise;
    },
    getPersistedMessages: () => persistedMessages,
  };
};

const seedCommonRoutes = async (
  page: Page,
  userFixture: VaultFixture,
  conversations: ConversationFixture[],
  messageLists: Record<string, MessageRecordFixture[]>,
) => {
  await seedAuthenticatedUnlockState(page, userFixture);

  await page.route('http://localhost:8090/api/v1/user-key-pair', async (route) => {
    await route.fulfill({ json: userFixture.userKeyPairRecord });
  });

  await page.route('http://localhost:8090/api/v1/vault-session', async (route) => {
    await route.fulfill({ json: userFixture.vaultSession });
  });

  await page.route('http://localhost:8090/api/v1/user-preferences', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    });
  });

  await page.route('http://localhost:8090/api/v1/models', async (route) => {
    await route.fulfill({ json: modelsResponse });
  });

  await page.route('http://localhost:8090/api/v1/conversations', async (route) => {
    await route.fulfill({
      json: conversations.map((conversation) => conversation.conversationRecord),
    });
  });

  for (const conversation of conversations) {
    const conversationId = conversation.conversationRecord.id;

    await page.route(
      `http://localhost:8090/api/v1/conversations/${conversationId}/public-key`,
      async (route) => {
        await route.fulfill({ json: conversation.conversationPublicKeyRecord });
      },
    );

    await page.route(
      `http://localhost:8090/api/v1/conversations/${conversationId}/secret-key`,
      async (route) => {
        await route.fulfill({ json: conversation.conversationSecretKeyRecord });
      },
    );

    await page.route(
      `http://localhost:8090/api/v1/conversations/${conversationId}/messages?page=1&page_size=100`,
      async (route) => {
        const items = messageLists[conversationId] ?? [];
        await route.fulfill({
          json: {
            page: 1,
            perPage: 100,
            totalItems: items.length,
            totalPages: 1,
            items,
          },
        });
      },
    );
  }
};

test('switching conversations during streaming does not leak content or errors', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_switch', 'switch@example.com');
  const conversationA = buildConversationFixture(
    userFixture,
    'conv_e2e_switch_a',
    'Streaming conversation A',
  );
  const conversationB = buildConversationFixture(
    userFixture,
    'conv_e2e_switch_b',
    'Quiet conversation B',
  );

  const messageLists: Record<string, MessageRecordFixture[]> = {
    [conversationA.conversationRecord.id]: [],
    [conversationB.conversationRecord.id]: [],
  };

  const completionMock = createCompletionMock({
    conversationFixture: conversationA,
    userFixture,
    userPrompt: 'Hello from switch e2e',
    assistantContent: 'Hi from the streamed backend',
  });

  try {
    completionMock.port = await listen(completionMock.server);
    await seedCommonRoutes(
      page,
      userFixture,
      [conversationA, conversationB],
      messageLists,
    );

    await page.route(
      `http://localhost:8090/api/v1/conversations/${conversationA.conversationRecord.id}/complete`,
      async (route) => {
        await route.continue({
          url: `http://127.0.0.1:${completionMock.port}/stream`,
        });
      },
    );

    await page.route(
      `http://localhost:8090/api/v1/conversations/${conversationB.conversationRecord.id}/complete`,
      async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Should not complete on B during this test',
          }),
        });
      },
    );

    await page.goto(`/c/${conversationA.conversationRecord.id}`);

    await expect(
      page.getByRole('heading', { name: 'Streaming conversation A' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'EU Model' })).toBeVisible();

    const composer = page.getByLabel('Message Cognos — encrypted on this device');
    await composer.fill('Hello from switch e2e');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText('Hello from switch e2e')).toBeVisible();
    await expect(page.locator('.message-list-item__streaming').last()).toContainText(
      'Hi from',
    );

    await page.getByRole('link', { name: 'Quiet conversation B' }).click();
    await expect(
      page.getByRole('heading', { name: 'Quiet conversation B' }),
    ).toBeVisible();

    await expect(page.locator('.message-list-item__streaming')).toHaveCount(0);
    await expect(page.getByText('Hi from')).toHaveCount(0);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);

    await completionMock.waitForPersisted();
    messageLists[conversationA.conversationRecord.id] =
      completionMock.getPersistedMessages();

    await page.getByRole('link', { name: 'Streaming conversation A' }).click();
    await expect(
      page.getByRole('heading', { name: 'Streaming conversation A' }),
    ).toBeVisible();
    await expect(page.getByText('Hello from switch e2e')).toBeVisible();
    await expect(page.getByText('Hi from the streamed backend')).toBeVisible();
    await expect(page.locator('.message-list-item__streaming')).toHaveCount(0);
  } finally {
    await closeServer(completionMock.server);
  }
});

test('reload shows completed messages after the stream connection drops', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_drop', 'drop@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_drop',
    'Disconnect conversation',
  );

  const messageLists: Record<string, MessageRecordFixture[]> = {
    [conversationFixture.conversationRecord.id]: [],
  };

  const completionMock = createCompletionMock({
    conversationFixture,
    userFixture,
    userPrompt: 'Hello after disconnect',
    assistantContent: 'Recovered after disconnect',
    disconnectAfterFirstDelta: true,
  });

  try {
    completionMock.port = await listen(completionMock.server);
    await seedCommonRoutes(page, userFixture, [conversationFixture], messageLists);

    await page.route(
      `http://localhost:8090/api/v1/conversations/${conversationFixture.conversationRecord.id}/complete`,
      async (route) => {
        await route.continue({
          url: `http://127.0.0.1:${completionMock.port}/stream`,
        });
      },
    );

    await page.goto(`/c/${conversationFixture.conversationRecord.id}`);

    await expect(
      page.getByRole('heading', { name: 'Disconnect conversation' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'EU Model' })).toBeVisible();

    const composer = page.getByLabel('Message Cognos — encrypted on this device');
    await composer.fill('Hello after disconnect');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText('Hello after disconnect')).toBeVisible();
    await expect(page.locator('.message-list-item__streaming').last()).toContainText(
      'Hi from',
    );

    await completionMock.waitForPersisted();
    messageLists[conversationFixture.conversationRecord.id] =
      completionMock.getPersistedMessages();

    await page.reload();

    await expect(
      page.getByRole('heading', { name: 'Disconnect conversation' }),
    ).toBeVisible();
    await expect(page.getByText('Hello after disconnect')).toBeVisible();
    await expect(page.getByText('Recovered after disconnect')).toBeVisible();
    await expect(page.locator('.message-list-item__streaming')).toHaveCount(0);
  } finally {
    await closeServer(completionMock.server);
  }
});
