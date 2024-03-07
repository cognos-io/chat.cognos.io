import { Injectable } from '@angular/core';
import PocketBase, {
  AuthMethodsList,
  RecordAuthResponse,
  RecordModel,
} from 'pocketbase';
import { Observable, from } from 'rxjs';
import { environment } from '../../environments/environment.development';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly authCollection: string = 'users';
  private readonly pb: PocketBase;

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
