import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { EMPTY, catchError } from 'rxjs';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosAuthPageComponent } from '@cognos/ui-angular';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';

import { AuthService } from '@services/auth.service';

type VerificationState = 'verifying' | 'success' | 'error' | 'missing-token';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [
    CognosAuthPageComponent,
    RouterLink,
    TranslocoModule,
    CognosLogoComponent,
    LoadingIndicatorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-auth-page>
      <ng-container *transloco="let t">
        <app-cognos-logo class="auth-page__logo"></app-cognos-logo>
        <h1 class="auth-page__title">{{ t('auth.verify.title') }}</h1>

        @switch (state()) {
          @case ('verifying') {
            <p class="auth-page__lead">
              <app-loading-indicator></app-loading-indicator>
              {{ t('auth.verify.verifying') }}
            </p>
          }
          @case ('success') {
            <p class="auth-page__success">{{ t('auth.verify.success') }}</p>
            <a routerLink="/auth/login" class="auth-page__switch">{{
              t('auth.verify.continueToLogin')
            }}</a>
          }
          @case ('error') {
            <p class="auth-page__hint" role="alert">{{ t('auth.verify.error') }}</p>
            <a routerLink="/auth/login" class="auth-page__switch">{{
              t('auth.verify.goToLogin')
            }}</a>
          }
          @case ('missing-token') {
            <p class="auth-page__hint" role="alert">
              {{ t('auth.verify.missingToken') }}
            </p>
            <a routerLink="/auth/login" class="auth-page__switch">{{
              t('auth.verify.goToLogin')
            }}</a>
          }
        }
      </ng-container>
    </cog-auth-page>
  `,
})
export class VerifyEmailComponent implements OnInit {
  private readonly _authService = inject(AuthService);
  private readonly _route = inject(ActivatedRoute);

  readonly state = signal<VerificationState>('verifying');

  ngOnInit(): void {
    const token = this._route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.state.set('missing-token');
      return;
    }

    this._authService
      .confirmVerification(token)
      .pipe(
        catchError(() => {
          this.state.set('error');
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.state.set('success');
      });
  }
}
