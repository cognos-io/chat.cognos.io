import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { EMPTY, catchError } from 'rxjs';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosAuthPageComponent, CognosButtonComponent } from '@cognos/ui-angular';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';

import { AuthService } from '@services/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoModule,
    CognosAuthPageComponent,
    CognosButtonComponent,
    CognosLogoComponent,
    LoadingIndicatorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-auth-page>
      <ng-container *transloco="let t">
        <app-cognos-logo class="auth-page__logo" palette="dark"></app-cognos-logo>
        <h1 class="auth-page__title">{{ t('auth.forgot.title') }}</h1>

        @if (sent()) {
          <p class="auth-page__success">
            {{ t('auth.forgot.sent', { email: submittedEmail() }) }}
          </p>
          <p class="auth-page__lead">{{ t('auth.forgot.sentNote') }}</p>
          <p class="auth-page__switch">
            <a routerLink="/auth/login">{{ t('auth.forgot.backToLogin') }}</a>
          </p>
        } @else {
          <p class="auth-page__lead">{{ t('auth.forgot.lead') }}</p>

          <form
            class="auth-page__form"
            [formGroup]="forgotForm"
            (ngSubmit)="onSubmit()"
          >
            <label class="auth-page__field" for="email">
              <span class="auth-page__label">{{ t('common.email') }}</span>
              <input
                id="email"
                class="auth-page__input"
                formControlName="email"
                type="email"
                autocomplete="email"
                [placeholder]="t('common.emailPlaceholder')"
              />
            </label>

            <cog-button
              appearance="primary"
              [fullWidth]="true"
              size="lg"
              type="submit"
              [disabled]="sending() || forgotForm.invalid"
            >
              @if (sending()) {
                <span class="auth-page__loading-copy">
                  <app-loading-indicator></app-loading-indicator>
                  {{ t('auth.forgot.sending') }}
                </span>
              } @else {
                {{ t('auth.forgot.submit') }}
              }
            </cog-button>
          </form>

          <p class="auth-page__switch">
            <a routerLink="/auth/login">{{ t('auth.forgot.backToLogin') }}</a>
          </p>
        }
      </ng-container>
    </cog-auth-page>
  `,
})
export class ForgotPasswordComponent {
  private readonly _authService = inject(AuthService);
  private readonly _fb = inject(FormBuilder);

  readonly sending = signal(false);
  readonly sent = signal(false);
  readonly submittedEmail = signal('');

  readonly forgotForm = this._fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  onSubmit(): void {
    if (this.forgotForm.invalid || this.sending()) {
      return;
    }

    const { email } = this.forgotForm.getRawValue();
    this.sending.set(true);

    this._authService
      .requestPasswordReset(email)
      .pipe(
        catchError(() => {
          this.sending.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.submittedEmail.set(email);
        this.sending.set(false);
        this.sent.set(true);
      });
  }
}
