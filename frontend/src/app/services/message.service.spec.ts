import { HttpErrorResponse } from '@angular/common/http';

import { describe, expect, it } from 'vitest';

import { ROOT_PARENT_KEY, selectActiveBranch } from '@cognos/ui-angular';

import { Message } from '@app/interfaces/message';

import { CompleteResponse } from './cognos-api.service';
import {
  DELETED_MESSAGE_MARKER,
  applyCompletionStreamDelta,
  applyCompletionStreamResponse,
  assertMessageBindings,
  buildCompletionMessageContext,
  buildCompletionMessages,
  buildDeletedMessageData,
  isCompletionAbortError,
  messageTreeAccessors,
  parseCompletionBillingRestriction,
  regenerateContextPath,
  removeStreamingCompletionMessages,
  resolveCompletionErrorMessage,
  resolveCompletionFailureMessage,
  splitStreamDeltaForDisplay,
  streamingAssistantMessageId,
} from './message.service';

const makeResponse = (overrides: Partial<CompleteResponse> = {}): CompleteResponse => ({
  assistantMessage: {
    id: 'asst-1',
    parentMessageId: 'user-1',
    content: 'hello back',
    personaId: 'cognos:simple-assistant',
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

describe('parseCompletionBillingRestriction', () => {
  const billing402 = (body: unknown): HttpErrorResponse =>
    new HttpErrorResponse({ status: 402, error: body });

  it('parses a trial-exhausted 402 into a structured restriction', () => {
    const restriction = parseCompletionBillingRestriction(
      billing402({
        error: 'TRIAL_EXHAUSTED',
        message: 'Your free trial has been used up.',
        balance_chf: 0.02,
        estimated_cost_chf: 0.32,
        next_step: 'subscribe',
      }),
    );

    expect(restriction).toEqual({
      code: 'TRIAL_EXHAUSTED',
      message: 'Your free trial has been used up.',
      balanceChf: 0.02,
      estimatedCostChf: 0.32,
      nextStep: 'subscribe',
    });
  });

  it('parses an inactive 402 and falls back to a default message', () => {
    const restriction = parseCompletionBillingRestriction(
      billing402({ error: 'INACTIVE', message: '   ' }),
    );

    expect(restriction?.code).toBe('INACTIVE');
    expect(restriction?.message).toBe(
      'Your account needs an active plan before you can keep chatting.',
    );
  });

  it('ignores non-402 errors', () => {
    expect(
      parseCompletionBillingRestriction(
        new HttpErrorResponse({ status: 500, error: { error: 'INACTIVE' } }),
      ),
    ).toBeNull();
  });

  it('ignores 402s without a recognised billing code', () => {
    expect(
      parseCompletionBillingRestriction(billing402({ error: 'SOMETHING_ELSE' })),
    ).toBeNull();
    expect(parseCompletionBillingRestriction(billing402(null))).toBeNull();
  });

  it('ignores errors that are not HTTP responses', () => {
    expect(parseCompletionBillingRestriction(new Error('boom'))).toBeNull();
    expect(parseCompletionBillingRestriction(undefined)).toBeNull();
  });
});

describe('isCompletionAbortError', () => {
  it('detects DOMException abort errors', () => {
    expect(isCompletionAbortError(new DOMException('aborted', 'AbortError'))).toBe(
      true,
    );
  });

  it('ignores regular errors', () => {
    expect(isCompletionAbortError(new Error('network down'))).toBe(false);
  });
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

describe('resolveCompletionFailureMessage', () => {
  it('reuses the HTTP-specific mapping when given an HttpErrorResponse', () => {
    const error = new HttpErrorResponse({
      status: 402,
      error: { message: 'Choose a plan to keep chatting.' },
    });

    expect(resolveCompletionFailureMessage(error)).toBe(
      'Choose a plan to keep chatting.',
    );
  });

  it('returns a plain Error message for non-HTTP failures', () => {
    expect(resolveCompletionFailureMessage(new Error('stream exploded'))).toBe(
      'stream exploded',
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
      persona_id: 'cognos:simple-assistant',
      model_id: 'infomaniak:llama-3',
    });
    expect(assistant.createdAt).toEqual(new Date('2026-01-02T03:04:05.000Z'));
    expect(assistant.expires).toBeUndefined();
  });

  it('omits expires when the response has no expiresAt', () => {
    const result = buildCompletionMessages([userMessage()], makeResponse());
    expect(result[1].expires).toBeUndefined();
  });

  it('parses PocketBase space-separated timestamps into valid dates', () => {
    const response = makeResponse({
      assistantMessage: {
        id: 'asst-1',
        parentMessageId: 'user-1',
        content: 'hello back',
        personaId: 'cognos:simple-assistant',
        modelId: 'infomaniak:llama-3',
        createdAt: '2026-01-02 03:04:05.000Z',
      },
    });

    const assistant = buildCompletionMessages([userMessage()], response)[1];

    expect(Number.isNaN(assistant.createdAt.getTime())).toBe(false);
    expect(assistant.createdAt).toEqual(new Date('2026-01-02T03:04:05.000Z'));
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

describe('buildDeletedMessageData', () => {
  it('clears content and flags deletion while preserving role and binding', () => {
    const tombstone = buildDeletedMessageData({
      version: '1',
      content: 'secret reply',
      conversation_id: 'conv-1',
      parent_message_id: 'user-1',
      created_at: '2026-01-02T03:04:05.000Z',
      persona_id: 'cognos:simple-assistant',
      model_id: 'infomaniak:llama-3',
      owner_id: undefined,
    });

    expect(tombstone).toEqual({
      version: '1',
      content: null,
      conversation_id: 'conv-1',
      parent_message_id: 'user-1',
      created_at: '2026-01-02T03:04:05.000Z',
      persona_id: 'cognos:simple-assistant',
      model_id: 'infomaniak:llama-3',
      owner_id: undefined,
      deleted: true,
    });
  });
});

describe('regenerateContextPath', () => {
  const node = (id: string, parentMessageId?: string): Message => ({
    record_id: id,
    parentMessageId,
    createdAt: new Date(),
    decryptedData: { content: id },
  });

  const path: Message[] = [
    node('u1'),
    node('a1', 'u1'),
    node('u2', 'a1'),
    node('a2', 'u2'),
  ];

  it('returns the path up to and including the parent message', () => {
    // Regenerating a2 (parent u2) replies to everything through u2, excluding a2.
    const context = regenerateContextPath(path, 'u2');
    expect(context.map((m) => m.record_id)).toEqual(['u1', 'a1', 'u2']);
  });

  it('returns the whole path when the parent is the last message', () => {
    const context = regenerateContextPath(path, 'a2');
    expect(context.map((m) => m.record_id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('returns empty for a missing parent or no parent id', () => {
    expect(regenerateContextPath(path, 'unknown')).toEqual([]);
    expect(regenerateContextPath(path, undefined)).toEqual([]);
  });
});

// Editing a user message forks the conversation: the amended turn is added as a
// new sibling (same parent) and selected. These tests pin the branch-resolution
// behaviour MessageService.editAndForkMessage relies on — including the root
// case, where the edited turn's siblings live under ROOT_PARENT_KEY.
describe('edit fork branch resolution', () => {
  let clock = 0;
  const node = (id: string, parentMessageId?: string): Message => ({
    record_id: id,
    parentMessageId,
    // Monotonic timestamps so the edited sibling is unambiguously the newest.
    createdAt: new Date(2026, 0, 1, 0, 0, clock++),
    decryptedData: { content: id, owner_id: parentMessageId ? undefined : 'u' },
  });

  it('follows the edited sibling and drops the original turn and its replies', () => {
    // u1 -> a1 -> u2 -> a2, then u2 is edited into sibling u2b (parent a1).
    const messages = [
      node('u1'),
      node('a1', 'u1'),
      node('u2', 'a1'),
      node('a2', 'u2'),
      node('u2b', 'a1'),
    ];

    const { path, branchPoints } = selectActiveBranch(messages, messageTreeAccessors, {
      selections: { a1: 'u2b' },
    });

    expect(path.map((m) => m.record_id)).toEqual(['u1', 'a1', 'u2b']);
    // a1 is now a fork point with two children (u2 and the edited u2b).
    expect(branchPoints.get('a1')).toBe(2);
  });

  it('defaults to the edited sibling as the newest even without a selection', () => {
    const messages = [
      node('u1'),
      node('a1', 'u1'),
      node('u2', 'a1'),
      node('u2b', 'a1'),
    ];

    const { path } = selectActiveBranch(messages, messageTreeAccessors, {});

    expect(path.map((m) => m.record_id)).toEqual(['u1', 'a1', 'u2b']);
  });

  it('forks a root user message under the root key', () => {
    // Editing the very first message: u1b is a root sibling of u1.
    const messages = [node('u1'), node('a1', 'u1'), node('u1b')];

    const { path } = selectActiveBranch(messages, messageTreeAccessors, {
      selections: { [ROOT_PARENT_KEY]: 'u1b' },
    });

    expect(path.map((m) => m.record_id)).toEqual(['u1b']);
  });
});

describe('splitStreamDeltaForDisplay', () => {
  it('keeps short deltas intact', () => {
    expect(splitStreamDeltaForDisplay('hi')).toEqual(['hi']);
  });

  it('splits large deltas into small display chunks', () => {
    expect(splitStreamDeltaForDisplay('streamed')).toEqual(['str', 'eam', 'ed']);
  });
});

describe('stream completion helpers', () => {
  const userMessage = (): Message => ({
    record_id: 'req-1',
    createdAt: new Date('2026-01-02T03:04:00.000Z'),
    decryptedData: { content: 'hello', owner_id: 'u-1' },
  });

  it('adds and appends assistant deltas to the same temporary assistant message', () => {
    const first = applyCompletionStreamDelta(
      [userMessage()],
      { requestId: 'req-1', content: 'hello' },
      'hel',
      'persona-1',
      'model-1',
    );
    const second = applyCompletionStreamDelta(
      first,
      { requestId: 'req-1', content: 'hello' },
      'lo',
      'persona-1',
      'model-1',
    );

    expect(second).toHaveLength(2);
    expect(second[1].record_id).toBe(streamingAssistantMessageId('req-1'));
    expect(second[1].decryptedData.content).toBe('hello');
    expect(second[1].isStreaming).toBe(true);
  });

  it('replaces the temporary ids with the final backend response on completion', () => {
    const streaming = applyCompletionStreamDelta(
      [userMessage()],
      { requestId: 'req-1', content: 'hello' },
      'hello back',
      'persona-1',
      'model-1',
    );

    const result = applyCompletionStreamResponse(
      streaming,
      'req-1',
      makeResponse({ userMessageId: 'user-1' }),
    );

    expect(result[0].record_id).toBe('user-1');
    expect(result[1].record_id).toBe('asst-1');
    expect(result[1].decryptedData.content).toBe('hello back');
    expect(result[1].isStreaming).toBeUndefined();
    expect(
      result.some(
        (message) => message.record_id === streamingAssistantMessageId('req-1'),
      ),
    ).toBe(false);
  });

  it('removes optimistic stream messages after a failure', () => {
    const streaming = applyCompletionStreamDelta(
      [userMessage()],
      { requestId: 'req-1', content: 'hello' },
      'partial',
      'persona-1',
      'model-1',
    );

    expect(removeStreamingCompletionMessages(streaming, 'req-1')).toEqual([]);
  });
});

describe('buildCompletionMessageContext', () => {
  const noopPersona = () => undefined;
  const noopModel = () => undefined;

  const makeMessage = (overrides: Partial<Message> = {}): Message => ({
    record_id: overrides.record_id ?? 'm',
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    parentMessageId: overrides.parentMessageId,
    expires: overrides.expires,
    decryptedData: overrides.decryptedData ?? { content: 'hi' },
  });

  it('returns an empty context when there are no messages', () => {
    expect(buildCompletionMessageContext([], 100, noopPersona, noopModel)).toEqual([]);
  });

  it('skips messages with empty or missing content', () => {
    const messages = [
      makeMessage({ decryptedData: { content: '', owner_id: 'u-1' } }),
      makeMessage({ decryptedData: { content: null, owner_id: 'u-1' } }),
      makeMessage({ decryptedData: { content: 'real', owner_id: 'u-1' } }),
    ];

    const context = buildCompletionMessageContext(
      messages,
      100,
      noopPersona,
      noopModel,
    );
    expect(context).toHaveLength(1);
    expect(context[0]).toMatchObject({ role: 'user', content: 'real', name: 'u-1' });
  });

  it('represents a soft-deleted message with the deletion marker, keeping role', () => {
    const messages = [
      makeMessage({
        decryptedData: { content: null, owner_id: 'u-1', deleted: true },
      }),
    ];

    const context = buildCompletionMessageContext(
      messages,
      100,
      noopPersona,
      noopModel,
    );
    expect(context).toEqual([
      { role: 'user', content: DELETED_MESSAGE_MARKER, name: 'u-1' },
    ]);
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
      noopPersona,
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
      noopPersona,
      noopModel,
    );

    expect(context[0]).toMatchObject({ role: 'user' });
    expect(context[1]).toMatchObject({ role: 'assistant' });
  });

  it('prefers owner_id for the participant name', () => {
    const msg = makeMessage({
      decryptedData: { content: 'hi', owner_id: 'u-1', persona_id: 'a', model_id: 'm' },
    });

    const context = buildCompletionMessageContext(
      [msg],
      100,
      () => 'persona-name',
      () => 'model-name',
    );

    expect(context[0].name).toBe('u-1');
  });

  it('falls back to the persona name when owner_id is absent', () => {
    const msg = makeMessage({
      decryptedData: { content: 'hi', persona_id: 'a', model_id: 'm' },
    });

    const context = buildCompletionMessageContext(
      [msg],
      100,
      () => 'persona-name',
      () => 'model-name',
    );

    expect(context[0].name).toBe('persona-name');
  });

  it('falls back to the model name when neither owner_id nor persona name resolves', () => {
    const msg = makeMessage({
      decryptedData: { content: 'hi', persona_id: 'a', model_id: 'm' },
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
    const context = buildCompletionMessageContext([msg], 100, noopPersona, noopModel);
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
    const context = buildCompletionMessageContext(msgs, 10, noopPersona, noopModel);
    // We took msgs[0..2] (8+5+5=18 < 20). msgs[3] would make it 23 >= 20.
    expect(context.map((c) => c.content)).toEqual(['ccccc', 'bbbbb', 'aaaaaaaa']);
  });

  it('returns an empty context when even the first message exceeds the budget', () => {
    // A pathological model with a 1-token (2-char) input budget rejects
    // everything bigger than that — we should send nothing rather than half a
    // message, and the caller can decide what to do.
    const msgs = [makeMessage({ decryptedData: { content: 'too long' } })];
    expect(buildCompletionMessageContext(msgs, 1, noopPersona, noopModel)).toEqual([]);
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
