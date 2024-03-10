import { Injectable, OnDestroy, inject } from '@angular/core';
import PocketBase, { AuthMethodsList, AuthModel } from 'pocketbase';
import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  from,
  map,
  of,
  switchMap,
} from 'rxjs';
import { signalSlice } from 'ngxtension/signal-slice';
import { filterNil } from 'ngxtension/filter-nil';
import { TypedPocketBase } from '../types/pocketbase-types';

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
  private readonly authCollection = 'users';
  private readonly pb: TypedPocketBase = inject(PocketBase);
  private readonly storeUnsubscribe: () => void;

  // sources
  readonly login$ = new Subject();
  readonly logout$ = new Subject();

  private readonly $user = new Subject<AuthUser>();
  private readonly $userAuthenticating = this.login$.pipe(
    switchMap(() => this.loginWithOry())
  );
  private readonly $userLoggingOut = this.logout$.pipe(
    switchMap(() => of(this.pb.authStore.clear()))
  );

  // state
  private state = signalSlice({
    initialState,
    sources: [
      this.login$.pipe(
        map(() => ({ status: 'authenticating' as LoginStatus }))
      ),
      // When user emits, if we have a user, we are authenticated
      this.$user.pipe(
        map((response: AuthUser) => {
          return {
            status: response
              ? ('success' as LoginStatus)
              : ('pending' as LoginStatus),
            user: response,
          };
        })
      ),
      this.$user.pipe(
        switchMap((response: AuthUser) =>
          this.fetchOryId(response?.['id']).pipe(
            map((oryId: string) => {
              return {
                oryId,
              };
            })
          )
        )
      ),
      // When login emits, we are authenticating
      this.$userAuthenticating.pipe(
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
        })
      ),
      // When logout emits, we are pending
      this.$userLoggingOut.pipe(
        map(() => {
          return {
            status: 'pending' as LoginStatus,
            user: null,
            oryId: '',
          };
        })
      ),
    ],
  });

  // selectors
  status = this.state.status;
  user = this.state.user;
  oryId = this.state.oryId;

  constructor() {
    // Listen for changes in the auth store
    this.storeUnsubscribe = this.pb.authStore.onChange((token, model) => {
      this.$user.next(model);
    }, true);
  }

  listAuthMethods(): Observable<AuthMethodsList> {
    return from(this.pb.collection(this.authCollection).listAuthMethods());
  }

  loginWithOry() {
    return from(
      this.pb.collection(this.authCollection).authWithOAuth2({
        // Make sure OIDC provider is configured in PocketBase for Ory
        provider: 'oidc',
        scopes: ['openid', 'offline_access'],
      })
    );
  }

  fetchOryId(userId: string) {
    if (!userId || userId === '') {
      return EMPTY;
    }
    return from(
      this.pb.collection(this.authCollection).listExternalAuths(userId)
    ).pipe(
      map((auths) => {
        return auths.find((auth) => auth.provider === 'oidc');
      }),
      filterNil(),
      map((auth) => auth.providerId)
    );
  }

  logout(): void {
    return this.pb.authStore.clear();
  }

  ngOnDestroy(): void {
    this.storeUnsubscribe();
  }
}
