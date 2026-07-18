import { safeInternalUrl } from './safe-redirect';

// Security pin: `next` comes straight from the query string, so anything that
// is not an app-internal path must be rejected — an accepted value is passed
// to router.navigateByUrl after login and would otherwise be an open redirect.
describe('safeInternalUrl', () => {
  const cases: {
    name: string;
    target: string | null | undefined;
    want: string | null;
  }[] = [
    // Sunny: internal targets pass through untouched.
    {
      name: 'internal path with query',
      target: '/invite?token=abc',
      want: '/invite?token=abc',
    },
    { name: 'root path', target: '/', want: '/' },
    {
      name: 'nested path',
      target: '/account/projects/p1',
      want: '/account/projects/p1',
    },

    // Rainy: everything non-internal is rejected.
    { name: 'absolute https URL', target: 'https://evil.example/', want: null },
    { name: 'scheme-relative URL', target: '//evil.example', want: null },
    { name: 'backslash schemeless URL', target: '/\\evil.example', want: null },
    { name: 'javascript scheme', target: 'javascript:alert(1)', want: null },
    { name: 'relative path', target: 'invite?token=abc', want: null },

    // Edge: absent values.
    { name: 'null', target: null, want: null },
    { name: 'undefined', target: undefined, want: null },
    { name: 'empty string', target: '', want: null },
  ];

  it.each(cases)('$name → $want', ({ target, want }) => {
    expect(safeInternalUrl(target)).toBe(want);
  });
});
