import { expect, test } from '@playwright/test';
import type { APIResponse } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import {
  newAnonymousApi,
  provisionApiUser,
  readOrgCompactionAccounting,
} from './api-helpers';
import { upsertOrgBilling } from './persona-helpers';

const APPROVED_MODEL_ID = 'llama-3-3-infomaniak';
const DEFAULT_PERSONA_ID = 'cognos:simple-assistant';
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful test persona.';

// Recognisable plaintext the mock embeds in its compaction summary. It must
// never appear in the stored ciphertext.
const MOCK_FACT = 'MOCK_COMPACTION_FACT';
const MOCK_NARRATIVE = 'MOCK_COMPACTION_NARRATIVE';

interface ConversationResponse {
  id: string;
}

interface MessageListResponse {
  totalItems: number;
  items: { id: string; data: string }[];
}

interface CompactionRecord {
  id: string;
  conversation: string;
  data: string;
  created: string;
  updated: string;
}

interface CreateCompactionResponse extends CompactionRecord {
  skipped?: boolean;
  reason?: string;
  payload?: {
    version: string;
    kind: string;
    conversation_id: string;
    anchor_message_id: string;
    covered_message_ids: string[];
    compaction_level: number;
    durable_memory: {
      items: string[];
    };
    rolling_narrative: string;
    citations: { label: string; message_id: string }[];
    model_id: string;
    prompt_version: string;
    output_mode: string;
  };
}

type ApiUser = Awaited<ReturnType<typeof provisionApiUser>>;

const CONVERSATION_DATA = Buffer.from(
  JSON.stringify({ title: 'compaction contract' }),
).toString('base64');

async function createConversationWithKey(user: ApiUser): Promise<string> {
  const res = await user.api.post('/api/v1/conversations', {
    data: { data: CONVERSATION_DATA, expiry_duration: '' },
  });
  expect(res.ok(), `conv: ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as ConversationResponse;

  const keyRes = await user.api.post(`/api/v1/conversations/${body.id}/public-key`, {
    data: {
      public_key: randomBytes(32).toString('base64'),
      public_key_signature: randomBytes(32).toString('base64'),
    },
  });
  expect(keyRes.ok(), `public-key: ${keyRes.status()}`).toBe(true);
  return body.id;
}

// Drives a persisted completion so the conversation has real messages we can
// anchor a compaction to, then returns their ids (oldest first).
async function seedMessages(user: ApiUser, conversationID: string): Promise<string[]> {
  const res = await user.api.post(`/api/v1/conversations/${conversationID}/complete`, {
    data: {
      model_id: APPROVED_MODEL_ID,
      persona_id: DEFAULT_PERSONA_ID,
      system_prompt: DEFAULT_SYSTEM_PROMPT,
      request_id: 'compaction-seed',
      messages: [{ role: 'user', content: 'hello from the compaction suite' }],
    },
  });
  expect(res.ok(), `seed complete: ${res.status()} ${await res.text()}`).toBe(true);
  await (res as APIResponse).body();

  const listRes = await user.api.get(
    `/api/v1/conversations/${conversationID}/messages?page=1&page_size=50`,
  );
  expect(listRes.ok()).toBe(true);
  const list = (await listRes.json()) as MessageListResponse;
  expect(list.items.length).toBeGreaterThanOrEqual(1);
  return list.items.map((m) => m.id);
}

function compactionBody(anchorID: string, messageID: string) {
  return {
    request_id: 'compaction-1',
    model_id: APPROVED_MODEL_ID,
    anchor_message_id: anchorID,
    source_token_estimate: 1234,
    messages: [
      {
        alias: 'M1',
        message_id: messageID,
        role: 'user',
        content: 'I prefer Postgres.',
      },
    ],
  };
}

test.describe('conversation compaction API', () => {
  test('org Project compaction accrues to the Organisation, not the acting member', async () => {
    const actor = await provisionApiUser();
    try {
      const orgRes = await actor.api.post('/api/v1/orgs', {
        data: { name: 'Compaction Accounting AG' },
      });
      expect(orgRes.status()).toBe(201);
      const { id: organisationId } = (await orgRes.json()) as { id: string };
      await upsertOrgBilling(organisationId, { planType: 'payg', seats: 1 });

      const projectRes = await actor.api.post('/api/v1/projects', {
        data: {
          data: randomBytes(48).toString('base64'),
          wrapped_project_key: randomBytes(48).toString('base64'),
          organisation: organisationId,
        },
      });
      expect(projectRes.status()).toBe(201);
      const { id: projectId } = (await projectRes.json()) as { id: string };

      const conversationRes = await actor.api.post(
        `/api/v1/projects/${projectId}/conversations`,
        {
          data: {
            data: CONVERSATION_DATA,
            public_key: randomBytes(32).toString('base64'),
            wrapped_conversation_secret_key: randomBytes(48).toString('base64'),
          },
        },
      );
      expect(
        conversationRes.status(),
        `create org conversation: ${conversationRes.status()} ${await conversationRes.text()}`,
      ).toBe(201);
      const { id: conversationId } = (await conversationRes.json()) as { id: string };

      const [anchorId] = await seedMessages(actor, conversationId);
      const before = await readOrgCompactionAccounting(organisationId, actor.userId);

      const compacted = await actor.api.post(
        `/api/v1/conversations/${conversationId}/compactions`,
        { data: compactionBody(anchorId, anchorId) },
      );
      expect(
        compacted.ok(),
        `compact org conversation: ${compacted.status()} ${await compacted.text()}`,
      ).toBe(true);

      const after = await readOrgCompactionAccounting(organisationId, actor.userId);
      expect(after.personalBalanceMicroRappen).toBe(before.personalBalanceMicroRappen);
      const priorIds = new Set(before.ledgerRows.map((row) => row.id));
      const newRows = after.ledgerRows.filter((row) => !priorIds.has(row.id));
      expect(newRows).toHaveLength(1);
      expect(newRows[0]).toMatchObject({
        organisation: organisationId,
        user_id: actor.userId,
      });
    } finally {
      await actor.api.dispose();
    }
  });

  test('participant can create, list and delete a compaction', async () => {
    const user = await provisionApiUser();
    try {
      const conversationID = await createConversationWithKey(user);
      const messageIDs = await seedMessages(user, conversationID);
      const anchorID = messageIDs[0];

      const createRes = await user.api.post(
        `/api/v1/conversations/${conversationID}/compactions`,
        { data: compactionBody(anchorID, anchorID) },
      );
      expect(
        createRes.ok(),
        `create: ${createRes.status()} ${await createRes.text()}`,
      ).toBe(true);
      const created = (await createRes.json()) as CreateCompactionResponse;

      expect(created.skipped ?? false).toBe(false);
      expect(created.id).toBeTruthy();
      expect(created.conversation).toBe(conversationID);
      expect(created.data).toBeTruthy();

      // Plaintext returned for immediate local use carries the model's summary
      // and the resolved citation (alias M1 -> real message id).
      expect(created.payload).toBeTruthy();
      expect(created.payload!.durable_memory.items.join(' ')).toContain(MOCK_FACT);
      expect(created.payload!.rolling_narrative).toContain(MOCK_NARRATIVE);
      expect(created.payload!.anchor_message_id).toBe(anchorID);
      expect(created.payload!.covered_message_ids).toContain(anchorID);
      expect(created.payload!.compaction_level).toBe(0);
      expect(created.payload!.prompt_version).toBe('compaction_v1');
      const m1 = created.payload!.citations.find((c) => c.label === 'M1');
      expect(m1?.message_id).toBe(anchorID);

      // Stored ciphertext must not leak the summary plaintext, raw or decoded.
      expect(created.data).not.toContain(MOCK_FACT);
      expect(created.data).not.toContain(MOCK_NARRATIVE);
      const decoded = Buffer.from(created.data, 'base64').toString('utf8');
      expect(decoded).not.toContain(MOCK_FACT);
      expect(decoded).not.toContain(MOCK_NARRATIVE);

      // List returns the record, ciphertext-only.
      const listRes = await user.api.get(
        `/api/v1/conversations/${conversationID}/compactions`,
      );
      expect(listRes.ok()).toBe(true);
      const list = (await listRes.json()) as { items: CompactionRecord[] };
      expect(list.items.map((i) => i.id)).toContain(created.id);
      for (const item of list.items) {
        expect(item.data).not.toContain(MOCK_FACT);
      }

      // Delete removes it.
      const deleteRes = await user.api.delete(
        `/api/v1/conversation-compactions/${created.id}`,
      );
      expect(deleteRes.status()).toBe(204);

      const afterList = await user.api.get(
        `/api/v1/conversations/${conversationID}/compactions`,
      );
      const after = (await afterList.json()) as { items: CompactionRecord[] };
      expect(after.items.map((i) => i.id)).not.toContain(created.id);
    } finally {
      await user.api.dispose();
    }
  });

  test('participant can update a compaction ciphertext; non-participant cannot', async () => {
    const owner = await provisionApiUser();
    const outsider = await provisionApiUser();
    try {
      const conversationID = await createConversationWithKey(owner);
      const [anchorID] = await seedMessages(owner, conversationID);

      const createRes = await owner.api.post(
        `/api/v1/conversations/${conversationID}/compactions`,
        { data: compactionBody(anchorID, anchorID) },
      );
      expect(createRes.ok()).toBe(true);
      const created = (await createRes.json()) as CreateCompactionResponse;

      const newData = Buffer.from('re-encrypted-edited-memory').toString('base64');

      // Outsider cannot update.
      const outsiderPatch = await outsider.api.patch(
        `/api/v1/conversation-compactions/${created.id}`,
        { data: { data: newData } },
      );
      expect(outsiderPatch.status()).toBe(404);

      // Owner updates the ciphertext.
      const patchRes = await owner.api.patch(
        `/api/v1/conversation-compactions/${created.id}`,
        { data: { data: newData } },
      );
      expect(
        patchRes.ok(),
        `patch: ${patchRes.status()} ${await patchRes.text()}`,
      ).toBe(true);

      const listRes = await owner.api.get(
        `/api/v1/conversations/${conversationID}/compactions`,
      );
      const list = (await listRes.json()) as { items: CompactionRecord[] };
      const updated = list.items.find((i) => i.id === created.id);
      expect(updated?.data).toBe(newData);
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });

  test('participant can create a manual memory; non-participant cannot', async () => {
    const owner = await provisionApiUser();
    const outsider = await provisionApiUser();
    try {
      const conversationID = await createConversationWithKey(owner);
      const data = Buffer.from('client-encrypted-manual-memory').toString('base64');

      const outsiderRes = await outsider.api.post(
        `/api/v1/conversations/${conversationID}/compactions/manual`,
        { data: { data } },
      );
      expect(outsiderRes.status()).toBe(404);

      const res = await owner.api.post(
        `/api/v1/conversations/${conversationID}/compactions/manual`,
        { data: { data } },
      );
      expect(res.ok(), `manual: ${res.status()} ${await res.text()}`).toBe(true);
      const created = (await res.json()) as CompactionRecord;
      expect(created.id).toBeTruthy();
      expect(created.data).toBe(data);

      // It shows up in the conversation's compaction list, ciphertext only.
      const listRes = await owner.api.get(
        `/api/v1/conversations/${conversationID}/compactions`,
      );
      const list = (await listRes.json()) as { items: CompactionRecord[] };
      expect(list.items.map((i) => i.id)).toContain(created.id);
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });

  test('create rejects an anchor that is not in the conversation', async () => {
    const user = await provisionApiUser();
    try {
      const conversationID = await createConversationWithKey(user);
      await seedMessages(user, conversationID);

      const res = await user.api.post(
        `/api/v1/conversations/${conversationID}/compactions`,
        { data: compactionBody('nonexistentmsg01', 'nonexistentmsg01') },
      );
      expect(res.status()).toBe(400);
      const body = (await res.json()) as { message?: string };
      expect(body.message ?? '').toMatch(/anchor/i);
    } finally {
      await user.api.dispose();
    }
  });

  test('create requires a model id', async () => {
    const user = await provisionApiUser();
    try {
      const conversationID = await createConversationWithKey(user);
      const [anchorID] = await seedMessages(user, conversationID);
      const res = await user.api.post(
        `/api/v1/conversations/${conversationID}/compactions`,
        {
          data: {
            anchor_message_id: anchorID,
            messages: [
              { alias: 'M1', message_id: anchorID, role: 'user', content: 'x' },
            ],
          },
        },
      );
      expect(res.status()).toBe(400);
    } finally {
      await user.api.dispose();
    }
  });

  test('unauthenticated callers are rejected', async () => {
    const api = await newAnonymousApi();
    try {
      const res = await api.post('/api/v1/conversations/anyconv00000001/compactions', {
        data: compactionBody('anymsg0000000001', 'anymsg0000000001'),
      });
      expect(res.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('non-participant cannot create, list or delete compactions', async () => {
    const owner = await provisionApiUser();
    const outsider = await provisionApiUser();
    try {
      const conversationID = await createConversationWithKey(owner);
      const [anchorID] = await seedMessages(owner, conversationID);

      // Owner creates one so there's something to (fail to) reach.
      const createRes = await owner.api.post(
        `/api/v1/conversations/${conversationID}/compactions`,
        { data: compactionBody(anchorID, anchorID) },
      );
      expect(createRes.ok()).toBe(true);
      const created = (await createRes.json()) as CreateCompactionResponse;

      // Outsider gets 404 on the conversation (existence hidden).
      const outsiderCreate = await outsider.api.post(
        `/api/v1/conversations/${conversationID}/compactions`,
        { data: compactionBody(anchorID, anchorID) },
      );
      expect(outsiderCreate.status()).toBe(404);

      const outsiderList = await outsider.api.get(
        `/api/v1/conversations/${conversationID}/compactions`,
      );
      expect(outsiderList.status()).toBe(404);

      const outsiderDelete = await outsider.api.delete(
        `/api/v1/conversation-compactions/${created.id}`,
      );
      expect(outsiderDelete.status()).toBe(404);

      // The record still exists for the owner.
      const ownerList = await owner.api.get(
        `/api/v1/conversations/${conversationID}/compactions`,
      );
      const list = (await ownerList.json()) as { items: CompactionRecord[] };
      expect(list.items.map((i) => i.id)).toContain(created.id);
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });
});
