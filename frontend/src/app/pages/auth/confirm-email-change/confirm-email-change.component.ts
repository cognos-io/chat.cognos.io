import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosAuthPageComponent,
  CognosButtonComponent,
  CognosTextFieldComponent,
} from '@cognos/ui-angular';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';

import { AuthService } from '@services/auth.service';

type ConfirmState = 'form' | 'submitting' | 'success' | 'error' | 'missing-token';

@Component({
  selector: 'app-confirm-email-change',
  standalone: true,
  imports: [
    CognosAuthPageComponent,
    RouterLink,
    TranslocoModule,
    CognosLogoComponent,
    CognosTextFieldComponent,
    CognosButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-auth-page>
      <ng-container *transloco="let t">
        <app-cognos-logo class="auth-page__logo"></app-cognos-logo>
        <h1 class="auth-page__title">{{ t('auth.confirmEmail.title') }}</h1>

        @switch (state()) {
          @case ('form') {
            <p class="auth-page__lead">{{ t('auth.confirmEmail.lead') }}</p>
            <div class="auth-page__field">
              <span class="auth-page__label">{{ t('common.password') }}</span>
              <cog-text-field
                [ariaLabel]="t('common.password')"
                type="password"
                [value]="password()"
                (valueChange)="password.set($event)"
              />
            </div>
            <cog-button
              appearance="primary"
              [disabled]="password().length === 0"
              (click)="confirm()"
            >
              {{ t('auth.confirmEmail.submit') }}
            </cog-button>
          }
          @case ('submitting') {
            <p class="auth-page__lead">{{ t('auth.confirmEmail.submitting') }}</p>
          }
          @case ('success') {
            <p class="auth-page__success">{{ t('auth.confirmEmail.success') }}</p>
            <a routerLink="/auth/login" class="auth-page__switch">{{
              t('auth.confirmEmail.continueToLogin')
            }}</a>
          }
          @case ('error') {
            <p class="auth-page__hint">{{ t('auth.confirmEmail.error') }}</p>
            <a routerLink="/auth/login" class="auth-page__switch">{{
              t('auth.confirmEmail.goToLogin')
            }}</a>
          }
          @case ('missing-token') {
            <p class="auth-page__hint">{{ t('auth.confirmEmail.missingToken') }}</p>
            <a routerLink="/auth/login" class="auth-page__switch">{{
              t('auth.confirmEmail.goToLogin')
            }}</a>
          }
        }
      </ng-container>
    </cog-auth-page>
  `,
})
export class ConfirmEmailChangeComponent implements OnInit {
  private readonly _authService = inject(AuthService);
  private readonly _route = inject(ActivatedRoute);

  readonly state = signal<ConfirmState>('form');
  readonly password = signal('');

  private _token = '';

  ngOnInit(): void {
    const token = this._route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.state.set('missing-token');
      return;
    }
    this._token = token;
  }

  confirm(): void {
    if (this.state() === 'submitting' || this.password().length === 0) {
      return;
    }

    this.state.set('submitting');
    this._authService.confirmEmailChange(this._token, this.password()).subscribe({
      next: () => this.state.set('success'),
      error: () => this.state.set('error'),
    });
  }
}
