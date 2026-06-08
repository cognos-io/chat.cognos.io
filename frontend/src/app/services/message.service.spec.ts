import { HttpErrorResponse } from '@angular/common/http';

import { describe, expect, it } from 'vitest';

import { Message } from '@app/interfaces/message';

import { CompleteResponse } from './cognos-api.service';
import {
  assertMessageBindings,
  buildCompletionMessageContext,
  buildCompletionMessages,
  resolveCompletionErrorMessage,
} from './message.service';

const makeResponse = (overrides: Partial<CompleteResponse> = {}): CompleteResponse => ({
  assistantMessage: {
    id: 'asst-1',
    parentMessageId: 'user-1',
    content: 'hello back',
    agentId: 'cognos:simple-assistant',
    modelId: 'infomaniak:llama-3',
    createdAt: '2026-01-02T03:04:05.000Z',
  },
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    costUSD: 0,
    costCHF: 0,
    costRappen: 0,
    usedProviderCost: false,
  },
  ...overrides,
});

describe('resolveCompletionErrorMessage', () => {
  it('uses the structured trial exhaustion message for 402 responses', () => {
    const error = new HttpErrorResponse({
      status: 402,
      error: {
        error: 'TRIAL_EXHAUSTED',
        message: 'Your free trial has been used up.',
        next_step: 'subscribe',
      },
    });

    expect(resolveCompletionErrorMessage(error)).toBe(
      'Your free trial has been used up.',
    );
  });

  it('uses the structured inactive-plan message for 402 responses', () => {
    const error = new HttpErrorResponse({
      status: 402,
      error: {
        error: 'INACTIVE',
        message: 'Choose a plan to keep chatting.',
        next_step: 'subscribe',
      },
    });

    expect(resolveCompletionErrorMessage(error)).toBe(
      'Choose a plan to keep chatting.',
    );
  });

  it('falls back to the legacy rate-limit copy for 429 responses', () => {
    const error = new HttpErrorResponse({ status: 429 });

    expect(resolveCompletionErrorMessage(error)).toBe(
      'Rate limiting error, you are sending too many messages. Please wait a few seconds before sending another message.',
    );
  });

  it('falls back to a generic billing message when 402 lacks structured details', () => {
    const error = new HttpErrorResponse({ status: 402 });

    expect(resolveCompletionErrorMessage(error)).toBe(
      'Your account needs an active plan before you can keep chatting.',
    );
  });

  it('falls back to a generic error message for other failures', () => {
    const error = new HttpErrorResponse({ status: 500 });

    expect(resolveCompletionErrorMessage(error)).toBe(
      'An error occurred while sending the message.',
    );
  });
});

describe('buildCompletionMessages', () => {
  const userMessage = (): Message => ({
    record_id: 'user-1',
    parentMessageId: undefined,
    createdAt: new Date('2026-01-02T03:04:00.000Z'),
    decryptedData: { content: 'hello', owner_id: 'u-1' },
  });

  it('appends a new assistant message mapped from the response', () => {
    const existing: Message[] = [userMessage()];
    const result = buildCompletionMessages(existing, makeResponse());

    expect(result).toHaveLength(2);
    const assistant = result[1];
    expect(assistant.record_id).toBe('asst-1');
    expect(assistant.parentMessageId).toBe('user-1');
    expect(assistant.decryptedData).toEqual({
      content: 'hello back',
      agent_id: 'cognos:simple-assistant',
      model_id: 'infomaniak:llama-3',
    });
    expect(assistant.createdAt).toEqual(new Date('2026-01-02T03:04:05.000Z'));
    expect(assistant.expires).toBeUndefined();
  });

  it('omits expires when the response has no expiresAt', () => {
    const result = buildCompletionMessages([userMessage()], makeResponse());
    expect(result[1].expires).toBeUndefined();
  });

  it('propagates expires to the parent message when present', () => {
    const existing = [userMessage()];
    const result = buildCompletionMessages(
      existing,
      makeResponse({ expiresAt: '2026-01-03T00:00:00.000Z' }),
    );

    const expires = new Date('2026-01-03T00:00:00.000Z');
    expect(result[0].expires).toEqual(expires);
    expect(result[1].expires).toEqual(expires);
  });

  it('does not mutate the original parent message when propagating expires', () => {
    // Signal-backed state stores the same object references that React-style
    // diffing sees, so an in-place write to `parent.expires` would silently
    // change the prior snapshot. Pin that buildCompletionMessages clones.
    const existing = [userMessage()];
    const originalParent = existing[0];
    buildCompletionMessages(
      existing,
      makeResponse({ expiresAt: '2026-01-03T00:00:00.000Z' }),
    );

    expect(originalParent.expires).toBeUndefined();
  });

  it('does not propagate expires when no parentMessageId is set on the response', () => {
    const existing = [userMessage()];
    const result = buildCompletionMessages(
      existing,
      makeResponse({
        expiresAt: '2026-01-03T00:00:00.000Z',
        assistantMessage: {
          ...makeResponse().assistantMessage,
          parentMessageId: undefined,
        },
      }),
    );

    expect(result[0].expires).toBeUndefined();
    expect(result[1].expires).toEqual(new Date('2026-01-03T00:00:00.000Z'));
  });

  it('returns a new array reference and does not mutate the input', () => {
    const existing = [userMessage()];
    const result = buildCompletionMessages(existing, makeResponse());
    expect(result).not.toBe(existing);
    expect(existing).toHaveLength(1);
  });
});

describe('buildCompletionMessageContext', () => {
  const noopAgent = () => undefined;
  const noopModel = () => undefined;

  const makeMessage = (overrides: Partial<Message> = {}): Message => ({
    record_id: overrides.record_id ?? 'm',
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    parentMessageId: overrides.parentMessageId,
    expires: overrides.expires,
    decryptedData: overrides.decryptedData ?? { content: 'hi' },
  });

  it('returns an empty context when there are no messages', () => {
    expect(buildCompletionMessageContext([], 100, noopAgent, noopModel)).toEqual([]);
  });

  it('skips messages with empty or missing content', () => {
    const messages = [
      makeMessage({ decryptedData: { content: '', owner_id: 'u-1' } }),
      makeMessage({ decryptedData: { content: null, owner_id: 'u-1' } }),
      makeMessage({ decryptedData: { content: 'real', owner_id: 'u-1' } }),
    ];

    const context = buildCompletionMessageContext(messages, 100, noopAgent, noopModel);
    expect(context).toHaveLength(1);
    expect(context[0]).toMatchObject({ role: 'user', content: 'real', name: 'u-1' });
  });

  it('flips chronologically: newest-first input becomes oldest-first context', () => {
    // The conversation history is reverse-ordered (newest first) when handed
    // in, but the LLM expects oldest-first; the unshift loop pins that flip.
    const newest = makeMessage({ decryptedData: { content: 'reply', model_id: 'm' } });
    const oldest = makeMessage({
      decryptedData: { content: 'hi', owner_id: 'u-1' },
    });

    const context = buildCompletionMessageContext(
      [newest, oldest],
      100,
      noopAgent,
      noopModel,
    );

    expect(context.map((c) => c.content)).toEqual(['hi', 'reply']);
  });

  it('infers role from owner_id (user) vs missing owner_id (assistant)', () => {
    const userMsg = makeMessage({
      decryptedData: { content: 'hi', owner_id: 'u-1' },
    });
    const asstMsg = makeMessage({ decryptedData: { content: 'hello' } });

    const context = buildCompletionMessageContext(
      [asstMsg, userMsg],
      100,
      noopAgent,
      noopModel,
    );

    expect(context[0]).toMatchObject({ role: 'user' });
    expect(context[1]).toMatchObject({ role: 'assistant' });
  });

  it('prefers owner_id for the participant name', () => {
    const msg = makeMessage({
      decryptedData: { content: 'hi', owner_id: 'u-1', agent_id: 'a', model_id: 'm' },
    });

    const context = buildCompletionMessageContext(
      [msg],
      100,
      () => 'agent-name',
      () => 'model-name',
    );

    expect(context[0].name).toBe('u-1');
  });

  it('falls back to the agent name when owner_id is absent', () => {
    const msg = makeMessage({
      decryptedData: { content: 'hi', agent_id: 'a', model_id: 'm' },
    });

    const context = buildCompletionMessageContext(
      [msg],
      100,
      () => 'agent-name',
      () => 'model-name',
    );

    expect(context[0].name).toBe('agent-name');
  });

  it('falls back to the model name when neither owner_id nor agent name resolves', () => {
    const msg = makeMessage({
      decryptedData: { content: 'hi', agent_id: 'a', model_id: 'm' },
    });

    const context = buildCompletionMessageContext(
      [msg],
      100,
      () => undefined,
      () => 'model-name',
    );

    expect(context[0].name).toBe('model-name');
  });

  it('leaves name undefined when no resolver returns a value', () => {
    const msg = makeMessage({ decryptedData: { content: 'hi' } });
    const context = buildCompletionMessageContext([msg], 100, noopAgent, noopModel);
    expect(context[0].name).toBeUndefined();
  });

  it('breaks before including the next message when the budget would overflow', () => {
    // Budget: 10 tokens => 20 chars. First two messages fit (5 + 5 = 10);
    // the third would push us to 15, still under — but the fourth at 20 would
    // hit the boundary. Pin that ">=" stops *before* the overflow message.
    const msgs = [
      makeMessage({ decryptedData: { content: 'aaaaaaaa' } }), // 8
      makeMessage({ decryptedData: { content: 'bbbbb' } }), // 5
      makeMessage({ decryptedData: { content: 'ccccc' } }), // 5
      makeMessage({ decryptedData: { content: 'ddddd' } }), // 5 — would tip
    ];
    const context = buildCompletionMessageContext(msgs, 10, noopAgent, noopModel);
    // We took msgs[0..2] (8+5+5=18 < 20). msgs[3] would make it 23 >= 20.
    expect(context.map((c) => c.content)).toEqual(['ccccc', 'bbbbb', 'aaaaaaaa']);
  });

  it('returns an empty context when even the first message exceeds the budget', () => {
    // A pathological model with a 1-token (2-char) input budget rejects
    // everything bigger than that — we should send nothing rather than half a
    // message, and the caller can decide what to do.
    const msgs = [makeMessage({ decryptedData: { content: 'too long' } })];
    expect(buildCompletionMessageContext(msgs, 1, noopAgent, noopModel)).toEqual([]);
  });
});

describe('assertMessageBindings', () => {
  it('accepts payloads with no declared bindings', () => {
    // The server-side encrypted payload may legitimately omit
    // conversation_id / parent_message_id for legacy rows. Those records must
    // not fail the binding check — only present-but-mismatched values should.
    expect(() =>
      assertMessageBindings({}, { conversation: 'c-1', parent_message: 'm-1' }),
    ).not.toThrow();
  });

  it('accepts a matching conversation_id', () => {
    expect(() =>
      assertMessageBindings({ conversation_id: 'c-1' }, { conversation: 'c-1' }),
    ).not.toThrow();
  });

  it('rejects a mismatched conversation_id', () => {
    expect(() =>
      assertMessageBindings(
        { conversation_id: 'attacker-conv' },
        { conversation: 'real-conv' },
      ),
    ).toThrow('Message conversation binding mismatch');
  });

  it('accepts a matching parent_message_id', () => {
    expect(() =>
      assertMessageBindings(
        { parent_message_id: 'm-1' },
        { conversation: 'c-1', parent_message: 'm-1' },
      ),
    ).not.toThrow();
  });

  it('rejects a mismatched parent_message_id', () => {
    expect(() =>
      assertMessageBindings(
        { parent_message_id: 'attacker-parent' },
        { conversation: 'c-1', parent_message: 'real-parent' },
      ),
    ).toThrow('Message parent binding mismatch');
  });

  it('rejects payloads that claim a missing parent when the record has one', () => {
    // Pinning the asymmetry of the parent check: the gate is "is undefined"
    // (not "is falsy"), so a decrypted parent_message_id of "" still
    // participates in the equality check and fails against a real parent.
    expect(() =>
      assertMessageBindings(
        { parent_message_id: '' },
        { conversation: 'c-1', parent_message: 'm-1' },
      ),
    ).toThrow('Message parent binding mismatch');
  });

  it('ignores conversation_id when the decrypted value is the empty string', () => {
    // Falsy conversation_id (empty string) means the payload makes no claim
    // about which conversation it belongs to. The check is gated on a truthy
    // decrypted value, so this is an accept path — pin it so the gate stays.
    expect(() =>
      assertMessageBindings({ conversation_id: '' }, { conversation: 'real-conv' }),
    ).not.toThrow();
  });
});
