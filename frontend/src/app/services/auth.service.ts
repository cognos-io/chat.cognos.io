import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import PocketBase, { AuthMethodsList, AuthModel } from 'pocketbase';

import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  defer,
  from,
  map,
  of,
  repeat,
  retry,
  switchMap,
  tap,
  throwError,
  timer,
} from 'rxjs';

import { TranslocoService } from '@jsverse/transloco';
import { signalSlice } from 'ngxtension/signal-slice';

import { normalizeAccountRetention } from '@app/utils/retention';

import { TypedPocketBase } from '../types/pocketbase-types';
import { Analytics } from './analytics/analytics';
import { AccountAuthMethodsResponse, CognosApiService } from './cognos-api.service';
import { ErrorService } from './error.service';
import { MfaService } from './mfa.service';
import { TrustedUnlockService } from './trusted-unlock.service';

// How often to re-check the auth record while the signed-in user is still
// unverified. Verification happens out-of-band (the user clicks the emailed
// link, usually in another tab or on another device), so this tab only learns
// about it by refreshing the token. Kept short so the composer unlocks within
// a few seconds of the click; the poll only runs while verification is
// pending, so the steady-state cost is zero.
const UNVERIFIED_REFRESH_INTERVAL_MS = 5_000;

export type LoginStatus =
  'pending' | 'authenticating' | 'mfa_required' | 'success' | 'error';

export type AuthUser = AuthModel | null | undefined;

export interface LoginRequest {
  email: string;
  password: string;
}

// Google OAuth (docs/business_processes/oauth-google-sign-in.md,
// oauth-account-link.md). 'accountExists' is the ACCOUNT_EXISTS_USE_PASSWORD
// collision — email already belongs to a password Account — everything else
// (popup closed, network error, wrong password on link) is 'generic'.
export type OAuthErrorKind = 'accountExists' | 'generic';

interface AuthState {
  status: LoginStatus;
  user: AuthUser;
  email: string;
  // Set when a password sign-in is accepted but a second factor is required.
  // Cleared once login completes or the user backs out.
  mfaSessionId: string;
}

const initialState: AuthState = {
  status: 'pending',
  user: null,
  email: '',
  mfaSessionId: '',
};

@Injectable({
  providedIn: 'root',
})
export class AuthService implements OnDestroy {
  private readonly _errorService = inject(ErrorService);
  private readonly _authCollection = 'users';
  private readonly _pb: TypedPocketBase = inject(PocketBase);
  private readonly _storeUnsubscribe: () => void;
  private readonly _router = inject(Router);
  private readonly _trustedUnlockService = inject(TrustedUnlockService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _mfaService = inject(MfaService);
  private readonly _analytics = inject(Analytics);
  private readonly _cognosApi = inject(CognosApiService);

  readonly login$ = new Subject<LoginRequest>();
  readonly logout$ = new Subject<boolean>();

  // Emits when password auth succeeds but the account requires a second factor.
  private readonly _mfaChallenge$ = new Subject<{ sessionId: string }>();
  // Emits to return the UI to the password step (user backed out of MFA).
  private readonly _mfaReset$ = new Subject<void>();

  private readonly _user$ = new Subject<AuthUser>();
  private readonly _userAuthenticating$ = this.login$.pipe(
    switchMap(({ email, password }) => this.loginWithPassword(email, password)),
  );
  private readonly userLoggingOut$ = this.logout$.pipe(
    switchMap(() => from(this.logout())),
  );

  private state = signalSlice({
    initialState,
    sources: [
      this.login$.pipe(
        map(({ email }) => ({
          status: 'authenticating' as LoginStatus,
          email,
          mfaSessionId: '',
        })),
      ),
      this._mfaChallenge$.pipe(
        map(({ sessionId }) => ({
          status: 'mfa_required' as LoginStatus,
          mfaSessionId: sessionId,
        })),
      ),
      this._mfaReset$.pipe(
        map(() => ({ status: 'pending' as LoginStatus, mfaSessionId: '' })),
      ),
      this._user$.pipe(
        map((response: AuthUser) => {
          return {
            status: response ? ('success' as LoginStatus) : ('pending' as LoginStatus),
            user: response,
            email: response?.['email'] ?? '',
            mfaSessionId: '',
          };
        }),
      ),
      this._userAuthenticating$.pipe(
        map(() => {
          return {};
        }),
        catchError(() => {
          return of({
            status: 'error' as LoginStatus,
            user: null,
            email: '',
          });
        }),
      ),
      this.userLoggingOut$.pipe(
        map(() => {
          return {
            status: 'pending' as LoginStatus,
            user: null,
            email: '',
          };
        }),
      ),
    ],
  });

  status = this.state.status;
  user = this.state.user;
  user$ = toObservable(this.user);
  email = this.state.email;
  mfaSessionId = this.state.mfaSessionId;

  // Whether the signed-in user still needs to confirm their email. AI-consuming
  // endpoints return 403 EMAIL_NOT_VERIFIED until they do, so the chat composer
  // reads this to show a calm "confirm your email" state. PocketBase re-resolves
  // the auth record (including `verified`) on token refresh and re-emits `user`,
  // so this flips to false — and the composer unlocks — without a full reload.
  readonly needsEmailVerification = computed(() => {
    const user = this.user();
    return !!user && user['verified'] !== true;
  });

  // The account-wide default auto-delete window (in days), read live from the
  // user record. 0 (or unset) means never; 7/30 delete N days after a
  // conversation's last activity. Normalised so an unexpected stored value
  // never leaves the selector with no active option.
  readonly defaultRetentionDays = computed(() =>
    normalizeAccountRetention(
      this.user()?.['default_retention_days'] as number | undefined,
    ),
  );

  // --- Google OAuth account state (docs/business_processes/oauth-google-sign-in.md,
  // oauth-account-link.md, account-delete.md) ---

  // The Cognos-specific auth-methods view (GET /api/v1/account/auth-methods),
  // deliberately separate from PocketBase's own listAuthMethods() above: that
  // reports collection-level sign-in options, this reports whether THIS
  // Account has a usable Cognos password and which OAuth providers are linked.
  private readonly _authMethods = signal<AccountAuthMethodsResponse | null>(null);
  readonly authMethods = this._authMethods.asReadonly();

  // Collection-level availability comes from PocketBase. Keep the Google CTA
  // hidden until a client id/secret is configured, rather than offering a
  // button that can only fail.
  private readonly _availableAuthMethods = signal<AuthMethodsList | null>(null);
  readonly googleAvailable = computed(
    () =>
      this._availableAuthMethods()?.oauth2.providers.some(
        (provider) => provider.name === 'google',
      ) ?? false,
  );

  // Defaults true (safest — shows the full password/MFA UI) until the first
  // load resolves, so a slow/failed fetch never hides security controls a
  // password Account actually has.
  readonly hasPassword = computed(() => this._authMethods()?.hasPassword ?? true);
  readonly isGoogleLinked = computed(
    () => this._authMethods()?.providers.includes('google') ?? false,
  );

  private readonly _googleBusy = signal(false);
  readonly googleBusy = this._googleBusy.asReadonly();

  private readonly _oauthError = signal<OAuthErrorKind | null>(null);
  readonly oauthError = this._oauthError.asReadonly();

  constructor() {
    this.listAuthMethods().pipe(takeUntilDestroyed()).subscribe();

    defer(() => this.checkAndRefreshToken())
      .pipe(
        takeUntilDestroyed(),
        repeat({ delay: 1000 * 60 * 5 }),
        retry({
          count: 5,
          delay: (_error, retryIndex) => {
            const interval = 500;
            const delay = Math.pow(2, retryIndex - 1) * interval;
            return timer(delay);
          },
        }),
      )
      .subscribe();

    // A user confirms their email by clicking the emailed link — typically in
    // another tab — so this tab's auth record goes stale (`verified` stays
    // false) and the composer would stay locked until the 5-minute refresh
    // above. While (and only while) verification is pending, refresh the token
    // on a short interval: the refreshed record lands in the authStore, which
    // re-emits `user` and flips `needsEmailVerification`, unlocking the
    // composer without a manual reload. Stops as soon as the record reports
    // verified or the user signs out.
    toObservable(this.needsEmailVerification)
      .pipe(
        switchMap((pending) =>
          pending
            ? timer(
                UNVERIFIED_REFRESH_INTERVAL_MS,
                UNVERIFIED_REFRESH_INTERVAL_MS,
              ).pipe(
                switchMap(() =>
                  // Transient failures are non-fatal — the next tick retries,
                  // and the 5-minute loop above owns hard 401 handling.
                  this.checkAndRefreshToken().pipe(catchError(() => EMPTY)),
                ),
              )
            : EMPTY,
        ),
        takeUntilDestroyed(),
      )
      .subscribe();

    this._storeUnsubscribe = this._pb.authStore.onChange((token, model) => {
      if (this._pb.authStore.isValid) {
        this._user$.next(model);
      } else if (model) {
        this._pb
          .collection(this._authCollection)
          .authRefresh()
          .catch((error) => {
            console.error('Error refreshing auth token', error);
            this._errorService.alert(this._transloco.translate('errors.refreshToken'));
            if (error?.status === 401) {
              this._router.navigate(['', 'auth', 'logout']);
            }
          });
      }
    }, true);
  }

  listAuthMethods(): Observable<AuthMethodsList> {
    return from(this._pb.collection(this._authCollection).listAuthMethods()).pipe(
      tap((methods) => this._availableAuthMethods.set(methods)),
      catchError(() => {
        this._errorService.alert(this._transloco.translate('errors.listAuthMethods'));
        console.error('Error listing auth methods');
        return EMPTY;
      }),
    );
  }

  /**
   * Sign in (or, for a brand-new email, sign up) with Google. Must be called
   * synchronously from a user-gesture handler (click) with no prior
   * `await`/Promise — PocketBase opens the OAuth popup synchronously as soon
   * as `authWithOAuth2` runs, and Safari blocks popups opened outside that
   * gesture's call stack.
   *
   * On ACCOUNT_EXISTS_USE_PASSWORD (email already belongs to a password
   * Account — docs/business_processes/oauth-account-link.md) `oauthError()`
   * is set to 'accountExists' so the caller can prompt the user to sign in
   * with their password instead.
   */
  loginWithGoogle(): Observable<AuthUser> {
    this._oauthError.set(null);
    this._googleBusy.set(true);
    return from(
      this._pb.collection(this._authCollection).authWithOAuth2({ provider: 'google' }),
    ).pipe(
      // Google sign-in never requires a second factor. Saving into authStore
      // (done internally by authWithOAuth2) fires the onChange listener below,
      // which pushes into the same _user$ pipeline password login uses — no
      // separate navigation wiring needed in the login/register components.
      tap(() => this._analytics.track('login_completed', { mfa: false })),
      map((response) => response.record as AuthUser),
      tap({
        next: () => this._googleBusy.set(false),
        error: () => this._googleBusy.set(false),
      }),
      catchError((error) => {
        this._oauthError.set(this._oauthErrorKind(error));
        console.error('Google sign-in failed');
        return throwError(() => error);
      }),
    );
  }

  /**
   * Connect Google to the signed-in Account (docs/business_processes/oauth-account-link.md).
   * Confirms `password`, then completes the OAuth round trip carrying the
   * resulting one-time link intent as `createData.cognosLinkIntent`.
   *
   * The password confirmation is an async HTTP call, so the OAuth popup
   * can't be opened synchronously from the click as `loginWithGoogle` does.
   * Pass a `popup` opened synchronously (`window.open('about:blank', ...)`)
   * in the click handler itself; this method navigates it once the Google
   * URL is known and closes it on failure. Without a `popup`, PocketBase
   * falls back to opening its own window, which browsers may block since it
   * no longer happens inside the gesture.
   */
  linkGoogle(
    password: string,
    popup: Window | null = null,
  ): Observable<AccountAuthMethodsResponse> {
    this._oauthError.set(null);
    this._googleBusy.set(true);
    return this._cognosApi.createOAuthLinkIntent(password, 'google').pipe(
      switchMap(({ linkIntentId }) =>
        from(
          this._pb.collection(this._authCollection).authWithOAuth2({
            provider: 'google',
            createData: { cognosLinkIntent: linkIntentId },
            urlCallback: (url) => this._navigatePopup(popup, url),
          }),
        ),
      ),
      switchMap(() => this.loadAuthMethods()),
      tap(() => this._googleBusy.set(false)),
      catchError((error) => {
        popup?.close();
        this._googleBusy.set(false);
        this._oauthError.set(this._oauthErrorKind(error));
        console.error('Connecting Google failed');
        return throwError(() => error);
      }),
    );
  }

  /**
   * Re-authenticate with Google to obtain an `oauthStepUpId` for deleting an
   * OAuth-only Account (docs/business_processes/account-delete.md — Google is
   * the only proof of identity such an Account can offer, in place of a
   * password + TOTP code). Mints a step-up challenge, carries it through the
   * OAuth round trip as `createData.cognosStepUpChallenge`, then confirms it.
   *
   * Same popup-timing note as `linkGoogle`: pass a `popup` opened
   * synchronously in the click handler.
   */
  stepUpWithGoogle(popup: Window | null = null): Observable<string> {
    this._oauthError.set(null);
    this._googleBusy.set(true);
    return this._cognosApi.beginOAuthStepUp().pipe(
      switchMap(({ challengeId }) =>
        from(
          this._pb.collection(this._authCollection).authWithOAuth2({
            provider: 'google',
            createData: { cognosStepUpChallenge: challengeId },
            // Make the Account holder actively select a Google identity. The
            // backend still binds the returned provider id to the exact
            // external-auth row; this prompt is UX, not the security check.
            query: { prompt: 'select_account' },
            urlCallback: (url) => this._navigatePopup(popup, url),
          }),
        ).pipe(switchMap(() => this._cognosApi.completeOAuthStepUp(challengeId))),
      ),
      map((response) => response.oauthStepUpId),
      tap(() => this._googleBusy.set(false)),
      catchError((error) => {
        popup?.close();
        this._googleBusy.set(false);
        this._oauthError.set('generic');
        console.error('Google re-authentication failed');
        return throwError(() => error);
      }),
    );
  }

  /** Cognos's own view of this Account's sign-in methods (see field above). */
  loadAuthMethods(): Observable<AccountAuthMethodsResponse> {
    return this._cognosApi.getAccountAuthMethods().pipe(
      tap((methods) => this._authMethods.set(methods)),
      catchError(() => {
        console.error('Failed to load auth methods');
        return EMPTY;
      }),
    );
  }

  /** Clear a previously surfaced OAuth error, e.g. before retrying. */
  resetOAuthError(): void {
    this._oauthError.set(null);
  }

  private _navigatePopup(popup: Window | null, url: string): void {
    if (popup && !popup.closed) {
      popup.location.href = url;
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  private _oauthErrorKind(error: unknown): OAuthErrorKind {
    const code = (error as { response?: { code?: string } })?.response?.code;
    return code === 'ACCOUNT_EXISTS_USE_PASSWORD' ? 'accountExists' : 'generic';
  }

  loginWithPassword(email: string, password: string) {
    // Present a remembered trusted-device token so an enrolled user on a known
    // device can skip the code step (the backend waives the second factor).
    const deviceToken = this._mfaService.deviceToken(email);
    const options = deviceToken
      ? { headers: { 'X-Cognos-MFA-Device': deviceToken } }
      : undefined;

    return from(
      this._pb
        .collection(this._authCollection)
        .authWithPassword(email, password, options),
    ).pipe(
      // Password-only sign-in completed (an MFA-enrolled account surfaces
      // mfa_required below instead, and completes via completeMfa).
      tap(() => this._analytics.track('login_completed', { mfa: false })),
      catchError((error) => {
        // A correct password for an MFA-enrolled account is not an error — it's
        // a prompt for the second factor. Surface the session id instead.
        const response = (
          error as { response?: { code?: string; mfaSessionId?: string } }
        )?.response;
        if (
          (error as { status?: number })?.status === 401 &&
          response?.code === 'mfa_required' &&
          response?.mfaSessionId
        ) {
          this._mfaChallenge$.next({ sessionId: response.mfaSessionId });
          return EMPTY;
        }

        this._errorService.alert(
          this._transloco.translate('errors.invalidCredentials'),
        );
        console.error(error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Complete a sign-in that is waiting on a second factor. On success the MFA
   * service saves the issued token into the authStore, which drives the rest of
   * the login/vault flow exactly like a normal sign-in.
   */
  completeMfa(
    method: 'totp' | 'recovery',
    code: string,
    rememberDevice: boolean,
  ): Observable<AuthUser> {
    const sessionId = this.mfaSessionId();
    const email = this.email();
    if (!sessionId) {
      return throwError(() => new Error('No active MFA session'));
    }

    const complete$ =
      method === 'totp'
        ? this._mfaService.completeTotp(sessionId, code, email, rememberDevice)
        : this._mfaService.completeRecovery(sessionId, code, email, rememberDevice);

    return complete$.pipe(
      tap(() => this._analytics.track('login_completed', { mfa: true })),
      map((record) => record as AuthUser),
      catchError((error) => {
        console.error('MFA completion failed', error);
        return throwError(() => error);
      }),
    );
  }

  /** Return to the password step (user cancelled the second-factor prompt). */
  resetMfaChallenge(): void {
    this._mfaReset$.next();
  }

  register(email: string, password: string): Observable<unknown> {
    return from(
      this._pb
        .collection(this._authCollection)
        .create({ email, password, passwordConfirm: password })
        .then(() =>
          this._pb.collection(this._authCollection).authWithPassword(email, password),
        ),
    ).pipe(
      catchError((error) => {
        const message =
          (error as { response?: { message?: string } })?.response?.message ??
          this._transloco.translate<string>('errors.createAccount');
        this._errorService.alert(message);
        console.error(error);
        return throwError(() => error);
      }),
    );
  }

  requestPasswordReset(email: string): Observable<boolean> {
    return from(
      this._pb.collection(this._authCollection).requestPasswordReset(email),
    ).pipe(
      catchError((error) => {
        const message =
          (error as { response?: { message?: string } })?.response?.message ??
          this._transloco.translate<string>('errors.sendPasswordReset');
        this._errorService.alert(message);
        console.error(error);
        return throwError(() => error);
      }),
    );
  }

  confirmPasswordReset(
    token: string,
    password: string,
    passwordConfirm: string,
  ): Observable<boolean> {
    return from(
      this._pb
        .collection(this._authCollection)
        .confirmPasswordReset(token, password, passwordConfirm),
    ).pipe(
      catchError((error) => {
        const message =
          (error as { response?: { message?: string } })?.response?.message ??
          this._transloco.translate<string>('errors.resetPassword');
        this._errorService.alert(message);
        console.error(error);
        return throwError(() => error);
      }),
    );
  }

  requestVerification(email: string): Observable<boolean> {
    return from(
      this._pb.collection(this._authCollection).requestVerification(email),
    ).pipe(
      catchError((error) => {
        this._errorService.alert(this._transloco.translate('errors.sendVerification'));
        console.error(error);
        return throwError(() => error);
      }),
    );
  }

  confirmVerification(token: string): Observable<boolean> {
    return from(
      this._pb.collection(this._authCollection).confirmVerification(token),
    ).pipe(
      // Onboarding funnel: the email step is done (no identifiers attached).
      tap(() =>
        this._analytics.track('onboarding_step_completed', {
          step: 'email_verified',
        }),
      ),
      catchError((error) => {
        this._errorService.alert(this._transloco.translate('errors.verifyEmail'));
        console.error(error);
        return throwError(() => error);
      }),
    );
  }

  // Patch the current user's own record (display name, avatar icon/colour).
  // PocketBase's SDK saves the updated auth record back into the authStore,
  // which fires onChange and refreshes the `user` signal — so the sidebar and
  // anywhere else reading the profile update without a manual refetch.
  updateProfile(patch: {
    display_name?: string;
    avatar_icon?: string;
    avatar_color?: string;
  }): Observable<AuthUser> {
    const userId = this.user()?.['id'] as string | undefined;
    if (!userId) {
      return throwError(() => new Error('Not authenticated'));
    }

    return from(this._pb.collection(this._authCollection).update(userId, patch)).pipe(
      map((record) => record as AuthUser),
      catchError((error) => {
        this._errorService.alert(this._transloco.translate('errors.updateProfile'));
        console.error(error);
        return throwError(() => error);
      }),
    );
  }

  // Set the data-processing (privacy) tier on the user's own record. The
  // PocketBase SDK saves the updated record into the authStore, which fires
  // onChange and re-emits `user` — so the model catalogue re-fetches and model
  // eligibility updates without a manual refresh.
  setPrivacyTier(tier: 'ch_only' | 'eu' | 'global'): Observable<AuthUser> {
    const userId = this.user()?.['id'] as string | undefined;
    if (!userId) {
      return throwError(() => new Error('Not authenticated'));
    }

    return from(
      this._pb.collection(this._authCollection).update(userId, { privacy_tier: tier }),
    ).pipe(
      map((record) => record as AuthUser),
      catchError((error) => {
        this._errorService.alert(this._transloco.translate('errors.updateRegion'));
        console.error(error);
        return throwError(() => error);
      }),
    );
  }

  // Persist the user's UI language onto their own record. The language is not
  // sensitive (unlike chat content) so it's stored in plaintext: it must apply
  // before the vault is unlocked, follow the user across devices, and be
  // available server-side (localised emails, Paddle checkout locale). The SDK
  // saves the updated record into the authStore, which re-emits `user`.
  setPreferredLanguage(language: string): Observable<AuthUser> {
    const userId = this.user()?.['id'] as string | undefined;
    if (!userId) {
      return throwError(() => new Error('Not authenticated'));
    }

    return from(
      this._pb
        .collection(this._authCollection)
        .update(userId, { preferred_language: language }),
    ).pipe(
      map((record) => record as AuthUser),
      catchError((error) => {
        // Non-fatal: the language still applies locally this session.
        console.error('Unable to save language preference', error);
        return throwError(() => error);
      }),
    );
  }

  // Persist the user's appearance theme preference onto their own record. Like
  // the language, the theme is not sensitive: it must apply before the vault is
  // unlocked (so the app doesn't flash the wrong theme on load) and follow the
  // user across devices, so it is stored in plaintext rather than in the
  // encrypted preferences payload. Value is one of light|dark|system.
  setPreferredTheme(theme: string): Observable<AuthUser> {
    const userId = this.user()?.['id'] as string | undefined;
    if (!userId) {
      return throwError(() => new Error('Not authenticated'));
    }

    return from(
      this._pb
        .collection(this._authCollection)
        .update(userId, { preferred_theme: theme }),
    ).pipe(
      map((record) => record as AuthUser),
      catchError((error) => {
        // Non-fatal: the theme still applies locally this session.
        console.error('Unable to save theme preference', error);
        return throwError(() => error);
      }),
    );
  }

  // Persist the account-wide default auto-delete window onto the user's own
  // record. Like the language/theme, retention is not sensitive chat content,
  // so it lives in plaintext on the auth record: it must apply server-side (the
  // deletion job reads it) and follow the user across devices. The SDK saves
  // the updated record into the authStore, which re-emits `user` — so the
  // selector reflects the new value without a manual refetch. Value is one of
  // 0 (never) | 7 | 30.
  setDefaultRetentionDays(days: number): Observable<AuthUser> {
    const userId = this.user()?.['id'] as string | undefined;
    if (!userId) {
      return throwError(() => new Error('Not authenticated'));
    }

    return from(
      this._pb
        .collection(this._authCollection)
        .update(userId, { default_retention_days: days }),
    ).pipe(
      map((record) => record as AuthUser),
      catchError((error) => {
        // Non-fatal: surfaced to the caller, which shows an error toast.
        console.error('Unable to save retention preference', error);
        return throwError(() => error);
      }),
    );
  }

  // Change the account password. Under account_key_v2 the password is
  // authentication-only (not part of the data key), so this is a pure auth
  // operation — no key material is re-wrapped. PocketBase verifies oldPassword
  // and rotates the auth token, so we re-authenticate with the new password to
  // keep the current session valid instead of bouncing the user to the login.
  changePassword(currentPassword: string, newPassword: string): Observable<AuthUser> {
    const user = this.user();
    const userId = user?.['id'] as string | undefined;
    const email = user?.['email'] as string | undefined;
    if (!userId || !email) {
      return throwError(() => new Error('Not authenticated'));
    }

    return from(
      this._pb.collection(this._authCollection).update(userId, {
        oldPassword: currentPassword,
        password: newPassword,
        passwordConfirm: newPassword,
      }),
    ).pipe(
      switchMap(() =>
        from(
          this._pb
            .collection(this._authCollection)
            .authWithPassword(email, newPassword),
        ),
      ),
      map((authData) => authData.record as AuthUser),
      catchError((error) => {
        console.error('Unable to change password', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Sign out every other device by rotating the auth token key. On success the
   * issued token is saved into the authStore so this session stays signed in.
   * Local MFA device trust is cleared to match the server revoke of trusted
   * devices (other machines must complete a fresh second factor).
   */
  revokeOtherSessions(): Observable<AuthUser> {
    return this._cognosApi.revokeOtherSessions().pipe(
      tap((res) => {
        this._pb.authStore.save(res.token, res.record);
        const email = (res.record as { email?: string } | null)?.email;
        if (email) {
          this._mfaService.clearDeviceToken(email);
        }
      }),
      map((res) => res.record as AuthUser),
      catchError((error) => {
        console.error('Unable to revoke other sessions', error);
        return throwError(() => error);
      }),
    );
  }

  // Request an email change. Under account_key_v2 the email is
  // authentication-only metadata (never an input to the data key), so changing
  // it is crypto-safe and never touches encrypted data. PocketBase sends a
  // confirmation link to the NEW address; the change only takes effect once
  // confirmEmailChange is called with that token + the current password.
  requestEmailChange(newEmail: string): Observable<boolean> {
    return from(
      this._pb.collection(this._authCollection).requestEmailChange(newEmail),
    ).pipe(
      catchError((error) => {
        const message =
          (error as { response?: { message?: string } })?.response?.message ??
          this._transloco.translate<string>('errors.startEmailChange');
        this._errorService.alert(message);
        console.error(error);
        return throwError(() => error);
      }),
    );
  }

  confirmEmailChange(token: string, password: string): Observable<boolean> {
    return from(
      this._pb.collection(this._authCollection).confirmEmailChange(token, password),
    ).pipe(
      catchError((error) => {
        const message =
          (error as { response?: { message?: string } })?.response?.message ??
          this._transloco.translate<string>('errors.confirmEmailChange');
        this._errorService.alert(message);
        console.error(error);
        return throwError(() => error);
      }),
    );
  }

  async logout(): Promise<void> {
    await this._trustedUnlockService.clearAllUnlockKeys();

    try {
      await this._pb.send('/v1/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('Error logging out', error);
    } finally {
      this._pb.authStore.clear();
    }
  }

  ngOnDestroy(): void {
    this._storeUnsubscribe();
  }

  private checkAndRefreshToken() {
    if (this.user() === null) {
      return EMPTY;
    }

    return from(this._pb.collection(this._authCollection).authRefresh()).pipe(
      catchError((error) => {
        console.error('Error refreshing auth token', error);
        return throwError(() => error);
      }),
    );
  }
}
