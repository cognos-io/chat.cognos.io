import { expect, test } from '@playwright/test';

import { markUserVerified, provisionApiUser } from './api-helpers';

// Email verification is mandatory before any chat message can be sent: the
// AI-consuming endpoints 403 with the machine-readable EMAIL_NOT_VERIFIED code
// until the user's email is verified. Everything else (conversations, keys,
// billing, models) stays available to unverified users.

interface VerificationRestriction {
  error: string;
  message: string;
  next_step?: string;
}

const COMPLETION_BODY = {
  model_id: 'llama-3-3-infomaniak',
  persona_id: 'cognos:simple-assistant',
  system_prompt: 'You are a helpful test persona.',
  messages: [{ role: 'user', content: 'hello' }],
};

test.describe('email verification gate', () => {
  test('unverified user cannot send completions and is unblocked by verifying', async () => {
    const user = await provisionApiUser({ verified: false });

    // Blocked: machine-readable 403 the frontend can branch on.
    const blocked = await user.api.post('/api/v1/completions', {
      data: COMPLETION_BODY,
    });
    expect(blocked.status()).toBe(403);
    const body = (await blocked.json()) as VerificationRestriction;
    expect(body.error).toBe('EMAIL_NOT_VERIFIED');
    expect(body.next_step).toBe('verify_email');

    // Non-AI surface stays available while unverified.
    const models = await user.api.get('/api/v1/models');
    expect(models.status()).toBe(200);
    const conversations = await user.api.get('/api/v1/conversations');
    expect(conversations.status()).toBe(200);
    const billing = await user.api.get('/api/v1/billing');
    expect(billing.status()).toBe(200);

    // Mid-session verification unblocks the SAME token immediately: the gate
    // reads the user record per request, so no re-login is needed.
    await markUserVerified(user.userId);

    const unblocked = await user.api.post('/api/v1/completions', {
      data: COMPLETION_BODY,
    });
    expect(
      unblocked.status(),
      `expected the gate to pass after verification: ${unblocked.status()} ${await unblocked.text()}`,
    ).toBe(200);
  });

  test('unverified user cannot generate images', async () => {
    const user = await provisionApiUser({ verified: false });

    const blocked = await user.api.post('/api/v1/conversations/any/image', {
      data: { model_id: 'gemini-2-5-flash-image', prompt: 'a swiss mountain' },
    });
    expect(blocked.status()).toBe(403);
    const body = (await blocked.json()) as VerificationRestriction;
    expect(body.error).toBe('EMAIL_NOT_VERIFIED');
  });

  test('unverified user cannot run model compaction', async () => {
    const user = await provisionApiUser({ verified: false });

    const blocked = await user.api.post('/api/v1/conversations/any/compactions', {
      data: {
        model_id: 'llama-3-3-infomaniak',
        anchor_message_id: 'x',
        messages: [{ role: 'user', content: 'hi' }],
      },
    });
    expect(blocked.status()).toBe(403);
    const body = (await blocked.json()) as VerificationRestriction;
    expect(body.error).toBe('EMAIL_NOT_VERIFIED');
  });

  test('verified user (helper default) passes the gate', async () => {
    const user = await provisionApiUser();

    const res = await user.api.post('/api/v1/completions', {
      data: COMPLETION_BODY,
    });
    expect(
      res.status(),
      `verified user must pass the verification gate: ${res.status()} ${await res.text()}`,
    ).toBe(200);
  });
});
