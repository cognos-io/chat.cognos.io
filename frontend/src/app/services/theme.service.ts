import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

import { applyTheme } from '@cognos/ui/theme';

import {
  DEFAULT_THEME_PREFERENCE,
  PREFERS_DARK_QUERY,
  ResolvedTheme,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  ThemePreference,
  isThemePreference,
  resolveInitialPreference,
  resolveTheme,
} from '@app/theme/theme';

import { AuthService } from '@services/auth.service';

/**
 * ThemeService owns the *runtime* appearance theme: it tracks the user's
 * preference (light/dark/system), resolves `system` against the device
 * colour-scheme, applies `data-theme` + `color-scheme` to the document, reacts
 * to live OS changes, and reconciles the device-local choice with the user's
 * saved account preference.
 *
 * Resolution layering mirrors LanguageService:
 *  - pre-auth: localStorage → default (`system`), applied before first paint by
 *    a tiny inline script in index.html so there is no light/dark flash.
 *  - authenticated: the account's `preferred_theme` becomes authoritative and is
 *    mirrored back to localStorage, so the theme follows the user across
 *    devices. A user with no saved preference yet has their current local choice
 *    captured to the account.
 *
 * The service persists only the *preference*. The resolved theme produced by
 * `system` is never persisted.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _auth = inject(AuthService);
  private readonly _destroyRef = inject(DestroyRef);

  readonly preferences: readonly ThemePreference[] = THEME_PREFERENCES;

  private readonly _preference = signal<ThemePreference>('system');
  /** The user's chosen preference (reactive). */
  readonly preference = this._preference.asReadonly();

  private readonly _resolved = signal<ResolvedTheme>('light');
  /** The concrete theme currently applied to the document (reactive). */
  readonly resolvedTheme = this._resolved.asReadonly();

  /** True when the resolved theme is following the device (preference=system). */
  readonly followingDevice = computed(() => this._preference() === 'system');

  // Guard so a stream of authStore emissions (token refreshes) doesn't fire
  // repeated capture PATCHes for the same user before the record reflects it.
  private _captureAttemptedFor: string | null = null;

  private _media: MediaQueryList | null = null;
  private readonly _onMediaChange = (event: MediaQueryListEvent): void => {
    // Device changes only move the app while the user is following the device.
    if (this._preference() === 'system') {
      this.applyResolved(event.matches);
    }
  };

  /** Called once from the app initializer, in an injection context. */
  init(): void {
    this._preference.set(readStoredPreference());

    this._media = matchPrefersDark();
    if (this._media) {
      this._media.addEventListener('change', this._onMediaChange);
      this._destroyRef.onDestroy(() =>
        this._media?.removeEventListener('change', this._onMediaChange),
      );
    }

    // Apply whatever the pre-bootstrap script already painted, keeping our
    // signals authoritative from here on.
    this.applyResolved(this.prefersDark());

    this._auth.user$.subscribe((user) => {
      if (!user) {
        this._captureAttemptedFor = null;
        return;
      }

      const userId = user['id'] as string | undefined;
      const pref = user['preferred_theme'] as string | undefined;

      if (isThemePreference(pref)) {
        if (pref !== this._preference()) {
          this.apply(pref);
        }
        return;
      }

      // No (valid) saved preference — adopt the device's current choice onto the
      // account so it persists and follows the user to other devices.
      if (userId && this._captureAttemptedFor !== userId) {
        this._captureAttemptedFor = userId;
        this._auth.setPreferredTheme(this._preference()).subscribe({
          error: () => {
            // Non-fatal: the local choice still applies this session.
            this._captureAttemptedFor = null;
          },
        });
      }
    });
  }

  /** User-initiated switch: applies, persists locally, and saves to the account. */
  use(preference: ThemePreference): void {
    if (!isThemePreference(preference) || preference === this._preference()) {
      return;
    }
    this.apply(preference);
    if (this._auth.user()) {
      this._captureAttemptedFor = this._auth.user()?.['id'] as string;
      this._auth.setPreferredTheme(preference).subscribe({ error: () => {} });
    }
  }

  // Switch the active preference, re-resolve, and mirror the preference (never
  // the resolved theme) to localStorage, without writing to the backend (used
  // both for user switches and for adopting the account preference).
  private apply(preference: ThemePreference): void {
    this._preference.set(preference);
    this.applyResolved(this.prefersDark());
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Private mode / storage disabled — theme still applies this session.
    }
  }

  // Resolve the current preference against the device and push the concrete
  // theme to the document via the shared @cognos/ui token system.
  private applyResolved(prefersDark: boolean): void {
    const resolved = resolveTheme(this._preference(), prefersDark);
    this._resolved.set(resolved);
    applyTheme(document.documentElement, { theme: resolved });
    document.documentElement.style.colorScheme = resolved;
  }

  private prefersDark(): boolean {
    return this._media?.matches ?? false;
  }
}

const readStoredPreference = (): ThemePreference => {
  try {
    return resolveInitialPreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
};

const matchPrefersDark = (): MediaQueryList | null => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia(PREFERS_DARK_QUERY);
};
