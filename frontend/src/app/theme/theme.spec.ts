import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  resolveInitialPreference,
  resolveTheme,
} from './theme';

describe('isThemePreference', () => {
  it.each(['light', 'dark', 'system'])('accepts %s', (value) => {
    expect(isThemePreference(value)).toBe(true);
  });

  it.each([null, undefined, '', 'System', 'auto', 'blue'])('rejects %s', (value) => {
    expect(isThemePreference(value)).toBe(false);
  });
});

describe('resolveInitialPreference', () => {
  it('keeps a valid stored preference', () => {
    expect(resolveInitialPreference('dark')).toBe('dark');
    expect(resolveInitialPreference('light')).toBe('light');
    expect(resolveInitialPreference('system')).toBe('system');
  });

  it('defaults invalid or missing values to system', () => {
    expect(resolveInitialPreference(null)).toBe(DEFAULT_THEME_PREFERENCE);
    expect(resolveInitialPreference('nonsense')).toBe('system');
    expect(DEFAULT_THEME_PREFERENCE).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('returns the explicit theme regardless of device preference', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('follows the device when preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});
