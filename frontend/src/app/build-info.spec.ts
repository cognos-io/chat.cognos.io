import { shortCommitSha } from './build-info';

describe('shortCommitSha', () => {
  it.each([
    { input: 'abcdef0123456789', want: 'abcdef0' },
    { input: 'abc', want: 'abc' },
    { input: 'unknown', want: 'unknown' },
    { input: '', want: 'unknown' },
    { input: null, want: 'unknown' },
    { input: undefined, want: 'unknown' },
    { input: '  paddedsha123  ', want: 'paddeds' },
  ])('shortCommitSha($input) → $want', ({ input, want }) => {
    expect(shortCommitSha(input)).toBe(want);
  });
});
