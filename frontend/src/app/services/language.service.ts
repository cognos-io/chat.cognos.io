import { Injectable, computed, inject, signal } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';

import {
  APP_LANGUAGES,
  AppLanguage,
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  findLanguage,
  isSupportedLanguage,
} from '@app/i18n/languages';

import { AuthService } from '@services/auth.service';

/**
 * LanguageService owns the *runtime* language: it switches Transloco's active
 * language, persists the choice, keeps `<html lang>` in sync, and reconciles the
 * device-local choice with the user's saved account preference.
 *
 * Resolution layering:
 *  - pre-auth: localStorage → browser languages → default (done in the app
 *    initializer before first paint, see transloco.providers.ts).
 *  - authenticated: the account's `preferred_language` becomes authoritative and
 *    is mirrored back to localStorage, so the language follows the user across
 *    devices. A user with no saved preference yet has their current (browser-
 *    inferred) choice captured to the account.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly _transloco = inject(TranslocoService);
  private readonly _auth = inject(AuthService);

  readonly languages: readonly AppLanguage[] = APP_LANGUAGES;

  private readonly _current = signal<string>(DEFAULT_LANGUAGE);
  /** The active language code (reactive). */
  readonly current = this._current.asReadonly();
  /** The active language descriptor (reactive). */
  readonly currentLanguage = computed(
    () => findLanguage(this._current()) ?? this.languages[0],
  );

  // Guard so a stream of authStore emissions (token refreshes) doesn't fire
  // repeated capture PATCHes for the same user before the record reflects it.
  private _captureAttemptedFor: string | null = null;

  /** Called once from the app initializer, in an injection context. */
  init(): void {
    this._current.set(this._transloco.getActiveLang());

    this._auth.user$.subscribe((user) => {
      if (!user) {
        this._captureAttemptedFor = null;
        return;
      }

      const userId = user['id'] as string | undefined;
      const pref = user['preferred_language'] as string | undefined;

      if (isSupportedLanguage(pref)) {
        if (pref !== this._current()) {
          this.apply(pref as string);
        }
        return;
      }

      // No (valid) saved preference — adopt the device's current choice onto the
      // account so it persists and follows the user to other devices.
      if (userId && this._captureAttemptedFor !== userId) {
        this._captureAttemptedFor = userId;
        this._auth.setPreferredLanguage(this._current()).subscribe({
          error: () => {
            // Non-fatal: the local choice still applies this session.
            this._captureAttemptedFor = null;
          },
        });
      }
    });
  }

  /** User-initiated switch: applies, persists locally, and saves to the account. */
  use(code: string): void {
    if (!isSupportedLanguage(code) || code === this._current()) {
      return;
    }
    this.apply(code);
    if (this._auth.user()) {
      this._captureAttemptedFor = this._auth.user()?.['id'] as string;
      this._auth.setPreferredLanguage(code).subscribe({ error: () => {} });
    }
  }

  // Switch the active language and mirror it to localStorage + <html lang>,
  // without writing to the backend (used both for user switches and for
  // adopting the account preference).
  private apply(code: string): void {
    this._transloco.setActiveLang(code);
    this._current.set(code);
    document.documentElement.lang = code;
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
    } catch {
      // Private mode / storage disabled — language still applies this session.
    }
  }
}
