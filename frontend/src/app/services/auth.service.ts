import { Injectable, OnDestroy, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import PocketBase, { AuthMethodsList, AuthModel } from 'pocketbase';

import { EMPTY, Observable, Subject, catchError, from, map, of, switchMap } from 'rxjs';

import { filterNil } from 'ngxtension/filter-nil';
import { signalSlice } from 'ngxtension/signal-slice';

import { TypedPocketBase } from '../types/pocketbase-types';
import { ErrorService } from './error.service';

export type LoginStatus = 'pending' | 'authenticating' | 'success' | 'error';

export type AuthUser = AuthModel | null | undefined;

interface AuthState {
  status: LoginStatus;
  user: AuthUser;
  oryId: string;
}

const initialState: AuthState = {
  status: 'pending',
  user: null,
  oryId: '',
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

  // sources
  readonly login$ = new Subject<boolean>();
  readonly logout$ = new Subject<boolean>();

  private readonly _user$ = new Subject<AuthUser>();
  private readonly _userAuthenticating$ = this.login$.pipe(
    switchMap(() => this.loginWithOry()),
  );
  private readonly userLoggingOut$ = this.logout$.pipe(
    switchMap(() => of(this.logout())),
  );

  // state
  private state = signalSlice({
    initialState,
    sources: [
      this.login$.pipe(map(() => ({ status: 'authenticating' as LoginStatus }))),
      // When user emits, if we have a user, we are authenticated
      this._user$.pipe(
        map((response: AuthUser) => {
          return {
            status: response ? ('success' as LoginStatus) : ('pending' as LoginStatus),
            user: response,
          };
        }),
      ),
      this._user$.pipe(
        switchMap((response: AuthUser) => {
          return this.fetchOryId(response?.['id']).pipe(
            map((oryId: string) => {
              return {
                oryId,
              };
            }),
          );
        }),
      ),
      // When login emits, we are authenticating
      this._userAuthenticating$.pipe(
        map(() => {
          return {
            status: 'success' as LoginStatus,
          };
        }),
        catchError(() => {
          return of({
            status: 'error' as LoginStatus,
            user: null,
          });
        }),
      ),
      // When logout emits, we are pending
      this.userLoggingOut$.pipe(
        map(() => {
          return {
            status: 'pending' as LoginStatus,
            user: null,
            oryId: '',
          };
        }),
      ),
    ],
  });

  // selectors
  status = this.state.status;
  user = this.state.user;
  user$ = toObservable(this.user);
  oryId = this.state.oryId;

  constructor() {
    // Listen for changes in the auth store
    this._storeUnsubscribe = this._pb.authStore.onChange((token, model) => {
      if (this._pb.authStore.isValid) {
        this._user$.next(model);
      } else {
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

  loginWithOry() {
    const w = window.open();

    return from(
      this._pb.collection(this._authCollection).authWithOAuth2({
        // Make sure OIDC provider is configured in PocketBase for Ory
        provider: 'oidc',
        scopes: ['openid', 'offline_access'],
        urlCallback: (url) => {
          if (w) {
            w.location.href = url;
          }
        },
      }),
    ).pipe(
      catchError((error) => {
        this._errorService.alert('Error logging in with Ory');
        console.error(error);
        w?.close();
        return of(null);
      }),
    );
  }

  fetchOryId(userId: string): Observable<string> {
    if (!userId || userId === '') {
      return EMPTY;
    }
    return from(
      this._pb.collection(this._authCollection).listExternalAuths(userId),
    ).pipe(
      catchError((error) => {
        this._errorService.alert('Error fetching Ory ID');
        console.error(error);
        return EMPTY;
      }),
      map((auths) => {
        return auths.find((auth) => auth.provider === 'oidc');
      }),
      filterNil(),
      map((auth) => auth.providerId),
    );
  }

  logout(): void {
    return this._pb.authStore.clear();
  }

  ngOnDestroy(): void {
    this._storeUnsubscribe();
  }
}
