import { Injectable } from '@angular/core';
import PocketBase, {
  AuthMethodsList,
  RecordAuthResponse,
  RecordModel,
} from 'pocketbase';
import { Observable, Subject, from } from 'rxjs';
import { environment } from '../../environments/environment.development';
import { signalSlice } from 'ngxtension/signal-slice';

export type LoginStatus = 'pending' | 'authenticating' | 'success' | 'error';

export type AuthUser = 

interface AuthState {
  status: LoginStatus;
}

const initialState: AuthState = {
  status: 'pending',
};

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  // sources
  login$ = new Subject();

  private readonly authCollection: string = 'users';
  private readonly pb: PocketBase;

  // state
  private state = signalSlice({
    initialState: initialState,
  });

  // selectors


  constructor() {
    this.pb = new PocketBase(environment.pocketbaseBaseUrl);
  }

  listAuthMethods(): Observable<AuthMethodsList> {
    return from(this.pb.collection(this.authCollection).listAuthMethods());
  }

  loginWithOry(): Observable<RecordAuthResponse<RecordModel>> {
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
}
