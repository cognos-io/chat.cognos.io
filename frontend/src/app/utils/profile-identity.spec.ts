import { describe, expect, it } from 'vitest';

import { deriveProfileName } from './profile-identity';

describe('deriveProfileName', () => {
  // Sunny: a set display name is used verbatim.
  it('prefers a non-empty display name', () => {
    expect(deriveProfileName('Ewan Jones', 'ewan.jones@example.com')).toBe(
      'Ewan Jones',
    );
  });

  // Sunny: derives title-cased words from the email local-part.
  it('title-cases the email local-part across separators', () => {
    expect(deriveProfileName('', 'ewan.jones@example.com')).toBe('Ewan Jones');
    expect(deriveProfileName(undefined, 'jane_doe-smith@x.io')).toBe('Jane Doe Smith');
  });

  it('handles a single-token local-part', () => {
    expect(deriveProfileName(null, 'tiers@example.com')).toBe('Tiers');
  });

  // Rainy/edge: nothing usable returns an empty string (never throws).
  it('returns an empty string when there is nothing to derive', () => {
    expect(deriveProfileName('', '')).toBe('');
    expect(deriveProfileName(undefined, undefined)).toBe('');
    expect(deriveProfileName('   ', '')).toBe('');
  });

  it('trims a whitespace-padded display name', () => {
    expect(deriveProfileName('  Ada  ', 'x@y.z')).toBe('Ada');
  });
});
