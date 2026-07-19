import { describe, expect, it } from 'vitest';

import { buildOrgInviteUrl } from './org-invite-link';

describe('buildOrgInviteUrl', () => {
  it('builds an absolute invite deep link (sunny)', () => {
    expect(buildOrgInviteUrl('abc123', 'https://app.cognos.io')).toBe(
      'https://app.cognos.io/invite?token=abc123',
    );
  });

  it('URL-encodes tokens that need escaping (edge)', () => {
    expect(buildOrgInviteUrl('a+b/c?', 'https://app.test')).toBe(
      'https://app.test/invite?token=a%2Bb%2Fc%3F',
    );
  });

  it('strips a trailing slash from the origin (edge)', () => {
    expect(buildOrgInviteUrl('tok', 'https://app.test/')).toBe(
      'https://app.test/invite?token=tok',
    );
  });

  it('returns empty when the token is blank (rainy)', () => {
    expect(buildOrgInviteUrl('', 'https://app.test')).toBe('');
    expect(buildOrgInviteUrl('   ', 'https://app.test')).toBe('');
  });
});
