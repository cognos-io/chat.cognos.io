import { HttpErrorResponse } from '@angular/common/http';

import { describe, expect, it } from 'vitest';

import { resolveCompletionErrorMessage } from './message.service';

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
