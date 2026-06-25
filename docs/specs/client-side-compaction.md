# Client-Side Conversation Compaction — Product & Architecture Spec

**Status:** Draft  
**Scope:** Automatically compact older messages in the current active branch so long encrypted chats
continue to fit model context windows without making the user manage summaries manually.  
**Related docs:**

- `docs/security-model.md`
- `docs/business_processes/completion-pipeline.md`
- `docs/business_processes/message-encryption.md`
- `docs/specs/reasoning-visibility.md`

## 0. Read this first

V1 is **background, encrypted, branch-aware compaction**.

- The browser decides **when** to compact and **which active-branch prefix** to compact.
- A dedicated backend endpoint runs the compaction prompt, calls the provider, encrypts the summary,
  and stores it in a dedicated `conversation_compactions` collection.
- The compaction table stores no plaintext summary, citations, token counts, anchor IDs, or covered
  message IDs. Those live inside the encrypted `data` blob.
- The feature is transparent in normal mode. Future power-user mode can show what was compacted.
- Compaction is opportunistic: it starts around **70%** context usage and must not block the user's
  next message.

## 1. Problem

Different models have different context windows. Today the frontend builds context from the active
message branch and drops older messages once the rough budget is full.

That is simple, but it loses useful history silently:

- long chats forget earlier decisions;
- switching to a smaller-context model degrades abruptly;
- future users will ask, “what got sent to the model?”;
- regenerating compactions after reload wastes money and time.

## 2. Goals

- Keep long chats useful as model context fills up.
- Persist compactions encrypted so they are reused across reloads/devices.
- Keep the server's database ciphertext-only for compaction content.
- Compact only the **current active branch**, not sibling branches the user is not viewing.
- Cite source message aliases in summaries so future UI can link back to source messages.
- Run compaction in the background after a response, not in the foreground send path.
- Keep V1 simple: rough token estimates are acceptable.

## 3. Non-goals

- Perfect token counting.
- Fully local in-browser LLM summarisation.
- Semantic search / embeddings / vector database memory.
- User-facing compaction controls in V1.
- Compacting temporary or disappearing-message conversations in V1.
- Exposing hidden provider chain-of-thought.

## 4. Definitions

| Term               | Meaning                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| **Active branch**  | The linear message path currently selected in the branching conversation tree.                          |
| **Compaction**     | An encrypted summary of an older prefix of the active branch.                                           |
| **Anchor message** | The newest source message covered by a compaction. If a compaction covers `m1..m5`, the anchor is `m5`. |
| **Raw tail**       | Recent messages after the anchor that are still sent verbatim.                                          |
| **Citation alias** | A provider-safe label like `[M12]`, mapped client-side to a real message ID.                            |
| **Usable context** | Model input context minus reserves for system prompt, current draft, output, and safety margin.         |

## 5. Product behaviour

### 5.1 Transparent by default

Normal users should not need to know compaction exists.

- No modal.
- No blocking spinner.
- No confirmation prompt.
- No change to the normal send action.

If compaction is still running when the user sends another message, the app sends with the best
available context. The completed compaction is used on later sends.

### 5.2 Future power-user visibility

V1 data must support future UI like:

```txt
Older context compacted · 43 messages · ~18k → ~1.4k tokens · View sources
```

Power-user mode may show:

- the encrypted summary after client-side decryption;
- source message links via citation aliases;
- rough source/summary token estimates;
- compaction model and prompt version;
- created time.

This UI is **not** in V1.

## 6. Data model

### 6.1 New collection: `conversation_compactions`

Plaintext fields only for access/routing:

```txt
id
conversation
data
created
updated
```

Notes:

- `conversation` is plaintext because the backend must authorise and list compactions for a
  conversation.
- All compaction details are inside encrypted `data`.
- Do not add plaintext `anchor_message`, `covered_count`, `token_count`, `model_id`, or `status` in
  V1.

### 6.2 Encrypted payload

`data` is:

```txt
base64(SealAnonymous(conversation_public_key, json_payload))
```

Payload shape:

```ts
{
  version: '1';
  kind: 'conversation_compaction';

  conversation_id: string;
  anchor_message_id: string;
  covered_message_ids: string[];

  summary: string;

  citations: Array<{
    label: string;      // e.g. "M12"
    message_id: string; // real PocketBase message id, never shown to provider
  }>;

  source_token_estimate: number;
  summary_token_estimate: number;

  model_id: string;
  prompt_version: 'compaction_v1';
  created_at: string;
}
```

### 6.3 Why the anchor is encrypted

The server does not need to know which messages the compaction covers. The browser loads all
compactions for the conversation, decrypts them, and builds:

```ts
Map<anchor_message_id, Compaction>
```

That is enough for context planning without leaking message graph details into plaintext columns.

## 7. API design

### 7.1 Create compaction

```txt
POST /api/v1/conversations/{conversationID}/compactions
```

Request:

```ts
{
  request_id: string;
  model_id: string;
  anchor_message_id: string;
  source_token_estimate: number;
  messages: Array<{
    alias: string; // "M1", "M2", ...
    role: 'user' | 'assistant';
    content: string;
  }>;
}
```

Backend responsibilities:

1. Authenticate user.
2. Verify conversation access.
3. Verify `anchor_message_id` belongs to the conversation.
4. Add the fixed backend-owned compaction system prompt.
5. Call the gateway with the supplied aliased messages.
6. Build the encrypted compaction payload.
7. Encrypt it with the conversation public key before persistence.
8. Insert into `conversation_compactions`.
9. Return the created encrypted record and, optionally, the plaintext summary for immediate local
   use.

The endpoint must not log request messages, summary text, or provider output.

### 7.2 List compactions

```txt
GET /api/v1/conversations/{conversationID}/compactions
```

Returns encrypted records for that conversation. The browser decrypts and validates payloads.

### 7.3 Delete compactions

```txt
DELETE /api/v1/conversation-compactions/{id}
```

Used when message deletion invalidates a compaction.

## 8. Compaction prompt

The compaction system prompt is backend-owned and versioned.

V1 prompt intent:

- Summarise the supplied conversation messages for future continuation.
- Preserve user goals, stable facts, constraints, decisions, open tasks, and important exact names.
- Preserve PII redaction placeholders exactly.
- Use citation aliases like `[M3]` for important claims.
- Do not include unsupported facts.
- Keep the summary concise but useful.

Suggested output format:

```md
## User goals

...

## Stable facts and preferences

...

## Decisions so far

...

## Open threads

...

## Important exact details

...
```

The model sees aliases, never real message IDs:

```txt
[M1] user: ...
[M2] assistant: ...
```

The encrypted payload maps aliases back to real message IDs.

## 9. Context-building algorithm

When sending a normal chat completion, the browser builds context from the active branch.

Given:

```txt
m1, m2, m3, m4, m5, m6, m7, m8
```

and a compaction anchored at `m5`, context becomes:

```txt
compaction_summary(m1..m5), m6, m7, m8, new_user_message
```

Rules:

1. Prefer the newest valid compaction whose anchor is on the active branch.
2. Include its summary as compacted prior context.
3. Include raw messages after the anchor.
4. Do not include raw messages covered by the compaction.
5. If no valid compaction fits, fall back to today's raw-tail truncation.
6. Never use a compaction from a sibling branch.

V1 can inject the compaction summary as a synthetic assistant context message, e.g.:

```ts
{
  role: 'assistant',
  content: 'Earlier conversation summary:\n...'
}
```

Do not inject compaction as a `system` message in the normal `messages` array: the backend strips
caller-supplied system messages and prepends the canonical `system_prompt` field.

## 10. Triggering and background work

### 10.1 Trigger threshold

After each successful assistant response, estimate active-branch context usage.

Trigger background compaction when:

```txt
estimated_context_tokens >= 70% of usable_context_tokens
```

Usable context roughly equals:

```txt
model.inputContextLength
- estimated system prompt tokens
- current/next user draft reserve
- max output reserve
- safety margin
```

V1 estimates are intentionally rough. A conservative character/token heuristic is acceptable.

### 10.2 Non-blocking rule

Compaction must not block chat.

- Start after a completed response, not before sending the user's current message.
- Keep one in-flight compaction per conversation.
- If the user sends while compaction runs, proceed without waiting.
- If compaction fails, log non-content metadata and try again after a later response.

### 10.3 Choosing what to compact

V1 compacts an older prefix of the active branch.

Prefer:

- enough source messages to materially reduce context;
- never the newest raw tail needed for conversational continuity;
- no messages already covered by the newest valid compaction.

A simple V1 policy:

1. Keep the newest 20–30% of usable context raw.
2. Compact the older prefix before that raw tail.
3. Anchor the compaction at the newest message in that prefix.

## 11. Security rules

- Persisted compaction content must be encrypted before durable storage.
- The compaction endpoint may process plaintext in-flight, just like the normal completion endpoint.
- No plaintext compaction summary, source messages, citations, or token details in logs.
- No plaintext compaction details in analytics or billing records.
- Citation aliases sent to providers must not contain database IDs.
- The encrypted payload must bind to `conversation_id`.
- The client must reject decrypted compaction payloads with mismatched `conversation_id`.
- The client must only use compactions whose anchor and covered messages match the active branch.

## 12. Deletion and retention

### 12.1 Message deletion

Soft-deleting a message must also remove or invalidate any compaction that covers it.

Because `covered_message_ids` is encrypted, the client must:

1. decrypt known compactions;
2. find compactions containing the deleted message ID;
3. delete those compactions before or alongside the message tombstone update.

V1 acceptance rule:

> A deleted message's content must not survive inside a persisted compaction summary.

### 12.2 Temporary and disappearing-message conversations

V1 does not create persisted compactions for:

- temporary/incognito conversations;
- conversations with disappearing-message expiry enabled.

Reason: a compaction could preserve content beyond the user's expected retention window.

## 13. Billing and cost

Compaction uses a provider call, so it has cost.

V1 policy options:

- use the selected model; simplest and most predictable quality;
- later, introduce a cheap eligible compaction model.

Recommended V1: use the selected model unless it is image-only or ineligible. If the selected model
cannot compact, skip background compaction and rely on raw-tail truncation.

Billing records should store normal numeric usage/cost metadata only. Never store compaction source
text or summary text.

## 14. Testing checklist

### Frontend unit tests

- Token planner triggers at 70% and not below.
- Active-branch planner uses the newest valid compaction anchor.
- Planner ignores compactions from sibling branches.
- Planner excludes raw messages covered by the compaction.
- Deleted-message flow identifies compactions covering the deleted message.

### API tests

- Non-participant cannot create/list/delete compactions.
- Create compaction rejects anchors outside the conversation.
- Stored compaction `data` is ciphertext, not plaintext summary.
- Logs/errors do not contain prompt, source messages, or summary text.
- Delete compaction checks conversation access.

### E2E tests

- Long conversation triggers background compaction after assistant response.
- A later send includes summary + raw tail, not the full covered prefix.
- Reloading the chat reuses persisted encrypted compaction.
- Deleting a covered message removes/invalidates the compaction.

## 15. Open questions

- Should V1 return plaintext summary in the create response for immediate use, or only encrypted
  record data that the client decrypts?
- Should a future setting let power users disable auto-compaction?
- Should a future compaction model be chosen per privacy tier and cost tier?
