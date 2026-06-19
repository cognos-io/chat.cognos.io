import { Injectable, OnDestroy, inject } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import PocketBase, { AuthMethodsList, AuthModel } from 'pocketbase';

import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  from,
  map,
  of,
  repeat,
  retry,
  switchMap,
  throwError,
  timer,
} from 'rxjs';

import { signalSlice } from 'ngxtension/signal-slice';

import { TypedPocketBase } from '../types/pocketbase-types';
import { ErrorService } from './error.service';
import { TrustedUnlockService } from './trusted-unlock.service';

export type LoginStatus = 'pending' | 'authenticating' | 'success' | 'error';

export type AuthUser = AuthModel | null | undefined;

export interface LoginRequest {
  email: string;
  password: string;
}

interface AuthState {
  status: LoginStatus;
  user: AuthUser;
  email: string;
}

const initialState: AuthState = {
  status: 'pending',
  user: null,
  email: '',
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

  readonly login$ = new Subject<LoginRequest>();
  readonly logout$ = new Subject<boolean>();

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
      this.login$.pipe(map(() => ({ status: 'authenticating' as LoginStatus }))),
      this._user$.pipe(
        map((response: AuthUser) => {
          return {
            status: response ? ('success' as LoginStatus) : ('pending' as LoginStatus),
            user: response,
            email: response?.['email'] ?? '',
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

  constructor() {
    this.checkAndRefreshToken()
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

    this._storeUnsubscribe = this._pb.authStore.onChange((token, model) => {
      if (this._pb.authStore.isValid) {
        this._user$.next(model);
      } else if (model) {
        this._pb
          .collection(this._authCollection)
          .authRefresh()
          .catch((error) => {
            console.error('Error refreshing auth token', error);
            this._errorService.alert('Error refreshing auth token');
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
        this._errorService.alert('Unable to list auth methods');
        console.error('Error listing auth methods', error);
        return EMPTY;
      }),
    );
  }

  loginWithPassword(email: string, password: string) {
    return from(
      this._pb.collection(this._authCollection).authWithPassword(email, password),
    ).pipe(
      catchError((error) => {
        this._errorService.alert('Invalid email or password');
        console.error(error);
        return throwError(() => error);
      }),
    );
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
          'Unable to create your account';
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
          'Unable to send password reset email';
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
          'Unable to reset password. The link may have expired.';
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
        this._errorService.alert('Unable to send verification email');
        console.error(error);
        return throwError(() => error);
      }),
    );
  }

  confirmVerification(token: string): Observable<boolean> {
    return from(
      this._pb.collection(this._authCollection).confirmVerification(token),
    ).pipe(
      catchError((error) => {
        this._errorService.alert('Unable to verify email. The link may have expired.');
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
        this._errorService.alert('Unable to update your profile');
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
        this._errorService.alert('Unable to update data processing region');
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
          'Unable to start the email change';
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
          'Unable to confirm the email change. The link may have expired.';
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
