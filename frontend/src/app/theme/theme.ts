// Central definitions for the appearance theme feature. Mirrors the shape of
// the language registry (see i18n/languages.ts): pure, framework-free helpers
// that both the pre-bootstrap flash guard and the runtime ThemeService share.
//
// Theme preference is what the user chooses; resolved theme is what the DOM
// receives. `system` is a preference only — it must never be written to
// `data-theme`; it resolves to `light` or `dark` from the device preference.

/** What the user chooses in settings. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** What the document's `data-theme` attribute actually receives. */
export type ResolvedTheme = 'light' | 'dark';

// Display/selection order in the Appearance control: System first, matching the
// spec's settings table.
export const THEME_PREFERENCES: readonly ThemePreference[] = [
  'system',
  'light',
  'dark',
] as const;

/** New users and new devices default to following the device. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

// Device-local store so the next page load can apply the theme before Angular
// boots and before auth, preventing a light/dark flash.
export const THEME_STORAGE_KEY = 'cognos:theme';

// Media query the OS exposes for its colour-scheme preference.
export const PREFERS_DARK_QUERY = '(prefers-color-scheme: dark)';

export const isThemePreference = (
  value: string | null | undefined,
): value is ThemePreference =>
  value === 'light' || value === 'dark' || value === 'system';

/**
 * Resolve a preference to the concrete theme the DOM should show. `system`
 * follows the device's current colour-scheme preference.
 */
export const resolveTheme = (
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme => {
  if (preference === 'dark') {
    return 'dark';
  }
  if (preference === 'light') {
    return 'light';
  }
  return prefersDark ? 'dark' : 'light';
};

/**
 * Resolve the preference to use before the user has made an explicit choice
 * this session. A previously-saved choice (localStorage) wins; any
 * invalid/absent value falls back to `system`. The backend account preference
 * is layered on later, once the user is authenticated (see ThemeService).
 */
export const resolveInitialPreference = (
  storedValue: string | null,
): ThemePreference =>
  isThemePreference(storedValue) ? storedValue : DEFAULT_THEME_PREFERENCE;
