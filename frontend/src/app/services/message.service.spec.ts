import { HttpErrorResponse } from '@angular/common/http';

import { describe, expect, it } from 'vitest';

import { Message } from '@app/interfaces/message';

import { CompleteResponse } from './cognos-api.service';
import {
  assertMessageBindings,
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
