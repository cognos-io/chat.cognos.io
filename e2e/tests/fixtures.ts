import { randomBytes } from 'node:crypto';

export interface TestAccount {
  email: string;
  password: string;
  vaultPassword: string;
}

/**
 * Generate a fresh account for a single test run.
 *
 * Emails embed a timestamp + random suffix so concurrent runs against the same
 * PocketBase dev database don't collide.
 */
export function makeTestAccount(): TestAccount {
  const suffix = randomBytes(3).toString('hex');
  return {
    email: `e2e-${Date.now()}-${suffix}@cognos-e2e.test`,
    password: 'CorrectHorseBatteryStaple1!',
    vaultPassword: 'vault-correct-horse-staple',
  };
}
