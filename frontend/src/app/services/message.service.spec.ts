import { HttpErrorResponse } from '@angular/common/http';

import { describe, expect, it } from 'vitest';

import {
  assertMessageBindings,
  resolveCompletionErrorMessage,
} from './message.service';

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
