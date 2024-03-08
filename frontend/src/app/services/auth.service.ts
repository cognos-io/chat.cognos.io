import { Injectable, OnDestroy } from '@angular/core';
import PocketBase, { AuthMethodsList, AuthModel } from 'pocketbase';
import {
  Observable,
  Subject,
  catchError,
  from,
  map,
  of,
  switchMap,
} from 'rxjs';
import { environment } from '../../environments/environment.development';
import { signalSlice } from 'ngxtension/signal-slice';

export type LoginStatus = 'pending' | 'authenticating' | 'success' | 'error';

export type AuthUser = AuthModel | null | undefined;

interface AuthState {
  status: LoginStatus;
  user: AuthUser;
}

const initialState: AuthState = {
  status: 'pending',
  user: null,
};

@Injectable({
  providedIn: 'root',
})
export class AuthService implements OnDestroy {
  private readonly authCollection: string = 'users';
  private readonly pb: PocketBase;
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
    initialState: initialState,
    sources: [
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
      // When login emits, we are authenticating
      this.$userAuthenticating.pipe(
        map(() => {
          return {
            status: 'authenticating' as LoginStatus,
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
          };
        })
      ),
    ],
  });

  // selectors
  status = this.state.status();
  user = this.state.user();

  constructor() {
    this.pb = new PocketBase(environment.pocketbaseBaseUrl);

    // Listen for changes in the auth store
    this.storeUnsubscribe = this.pb.authStore.onChange((token, model) => {
      this.$user.next(model);
    });
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

  logout(): void {
    return this.pb.authStore.clear();
  }

  ngOnDestroy(): void {
    this.storeUnsubscribe();
  }
}
