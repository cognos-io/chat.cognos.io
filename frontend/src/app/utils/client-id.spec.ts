import { describe, expect, it } from 'vitest';

import { clientId, uniqueClientIds } from './client-id';

describe('clientId', () => {
  it('produces a 15-char lowercase-alphanumeric id', () => {
    for (let i = 0; i < 200; i++) {
      expect(clientId()).toMatch(/^[a-z0-9]{15}$/);
    }
  });

  it('is overwhelmingly unique across many draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      seen.add(clientId());
    }
    // 5000 draws from 36^15 space: a collision would be a CSPRNG red flag.
    expect(seen.size).toBe(5000);
  });

  it('covers the whole alphabet over enough draws (no modulo bias dead zone)', () => {
    const chars = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      for (const c of clientId()) {
        chars.add(c);
      }
    }
    expect(chars.size).toBe(36);
  });
});

describe('uniqueClientIds', () => {
  it('returns the requested count of distinct ids', () => {
    const ids = uniqueClientIds(50);
    expect(ids).toHaveLength(50);
    expect(new Set(ids).size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]{15}$/);
    }
  });

  it('returns an empty list for zero', () => {
    expect(uniqueClientIds(0)).toEqual([]);
  });
});
