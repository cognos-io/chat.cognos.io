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

  readonly login$ = new Subject<LoginRequest>();
  readonly logout$ = new Subject<boolean>();

  private readonly _user$ = new Subject<AuthUser>();
  private readonly _userAuthenticating$ = this.login$.pipe(
    switchMap(({ email, password }) => this.loginWithPassword(email, password)),
  );
  private readonly userLoggingOut$ = this.logout$.pipe(
    switchMap(() => of(this.logout())),
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
            this._router.navigate(['', 'auth', 'logout']);
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
        this._errorService.alert('Unable to send password reset email');
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

  logout(): void {
    return this._pb.authStore.clear();
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
