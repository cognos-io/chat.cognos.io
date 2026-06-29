import { APIRequestContext, expect } from '@playwright/test';
import { createHmac } from 'crypto';

import { ProvisionedApiUser } from './api-helpers';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decode an RFC 4648 base32 string (the authenticator-app secret encoding). */
function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase().replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * Generate a TOTP code (RFC 6238) for a base32 secret. Mirrors the backend
 * defaults: SHA-1, 6 digits, 30s period. Implemented locally so the e2e suite
 * needs no extra dependency.
 */
export function generateTotp(secret: string, forTimeMs: number = Date.now()): string {
  const key = base32Decode(secret);
  let counter = Math.floor(forTimeMs / 1000 / 30);

  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }

  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (bin % 1_000_000).toString().padStart(6, '0');
}

export interface EnrolledMfa {
  secret: string;
  recoveryCodes: string[];
}

/** Enrol + confirm authenticator-app MFA for an already-provisioned user. */
export async function enrolMfa(user: ProvisionedApiUser): Promise<EnrolledMfa> {
  const enrol = await user.api.post('/api/v1/mfa/totp/enrol', {
    data: { password: user.account.password },
  });
  expect(enrol.ok(), `enrol: ${enrol.status()} ${await enrol.text()}`).toBe(true);
  const { secret } = (await enrol.json()) as { secret: string };

  const confirm = await user.api.post('/api/v1/mfa/totp/confirm', {
    data: { code: generateTotp(secret) },
  });
  expect(confirm.ok(), `confirm: ${confirm.status()} ${await confirm.text()}`).toBe(
    true,
  );
  const { recoveryCodes } = (await confirm.json()) as { recoveryCodes: string[] };

  return { secret, recoveryCodes };
}

export interface MfaChallenge {
  status: number;
  mfaSessionId?: string;
  hasToken: boolean;
}

/**
 * Attempt a password sign-in via PocketBase's own route and classify the
 * response: an MFA-enrolled user should get a 401 mfa_required with a session
 * id and no token. An optional trusted-device token can be supplied.
 */
export async function passwordLogin(
  api: APIRequestContext,
  email: string,
  password: string,
  deviceToken?: string,
): Promise<MfaChallenge> {
  const res = await api.post('/api/collections/users/auth-with-password', {
    data: { identity: email, password },
    headers: deviceToken ? { 'X-Cognos-MFA-Device': deviceToken } : {},
  });
  const body = (await res.json().catch(() => ({}))) as {
    mfaSessionId?: string;
    token?: string;
  };
  return {
    status: res.status(),
    mfaSessionId: body.mfaSessionId,
    hasToken: typeof body.token === 'string' && body.token.length > 0,
  };
}
