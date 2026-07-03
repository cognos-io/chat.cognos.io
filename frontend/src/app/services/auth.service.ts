import { Injectable, OnDestroy, computed, inject } from '@angular/core';
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

import { TypedPocketBase } from '../types/pocketbase-types';
import { Analytics } from './analytics/analytics';
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
  | 'pending'
  | 'authenticating'
  | 'mfa_required'
  | 'success'
  | 'error';

export type AuthUser = AuthModel | null | undefined;

export interface LoginRequest {
  email: string;
  password: string;
}

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

  constructor() {
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
      catchError((error) => {
        this._errorService.alert(this._transloco.translate('errors.listAuthMethods'));
        console.error('Error listing auth methods', error);
        return EMPTY;
      }),
    );
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
