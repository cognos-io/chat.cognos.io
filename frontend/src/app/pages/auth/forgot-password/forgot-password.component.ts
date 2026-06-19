import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { EMPTY, catchError } from 'rxjs';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosButtonComponent } from '@cognos/ui-angular';

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
    CognosButtonComponent,
    CognosLogoComponent,
    LoadingIndicatorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth-page">
      <section class="auth-page__card" *transloco="let t">
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
      </section>
    </div>
  `,
  styles: `
    .auth-page {
      display: grid;
      min-height: 100vh;
      min-height: 100svh;
      place-items: center;
      padding: var(--cog-space-300);
      background:
        radial-gradient(
          circle at top left,
          color-mix(in srgb, var(--cog-success-bg) 78%, transparent),
          transparent 35%
        ),
        var(--cog-app-bg);
    }

    .auth-page__card {
      display: grid;
      width: min(100%, 460px);
      gap: var(--cog-space-150);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      box-shadow: var(--cog-shadow-raised);
      padding: var(--cog-space-400);
    }

    .auth-page__form,
    .auth-page__field {
      display: grid;
      gap: var(--cog-space-150);
    }

    .auth-page__logo {
      height: 28px;
    }

    .auth-page__title,
    .auth-page__lead,
    .auth-page__switch,
    .auth-page__success {
      margin: 0;
    }

    .auth-page__title {
      color: var(--cog-text);
      font-size: var(--cog-fs-display);
      font-weight: var(--cog-fw-display);
      line-height: var(--cog-lh-display);
      letter-spacing: var(--cog-ls-display);
      text-wrap: balance;
    }

    .auth-page__lead,
    .auth-page__switch {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
      text-wrap: pretty;
    }

    .auth-page__label {
      color: var(--cog-text);
      font-size: var(--cog-fs-body-sm);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-body-sm);
    }

    .auth-page__input {
      min-height: 44px;
      border: 2px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-input-bg);
      color: var(--cog-text);
      padding: 0 var(--cog-space-150);
      font: inherit;
      outline: 0;
    }

    .auth-page__input:focus {
      border-color: var(--cog-brand);
      background: var(--cog-input-bg-focus);
    }

    .auth-page__success {
      color: var(--cog-text);
      border: 1px solid var(--cog-success-border, var(--cog-border));
      background: var(--cog-success-bg);
      padding: var(--cog-space-200);
      border-radius: var(--cog-radius-sm);
    }

    .auth-page__switch a {
      color: var(--cog-link);
    }

    .auth-page__loading-copy {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-100);
    }

    .auth-page__loading-copy app-loading-indicator {
      padding: 0;
    }

    @media (max-width: 640px) {
      .auth-page {
        place-items: stretch;
        padding: 0;
      }

      .auth-page__card {
        width: 100%;
        max-width: none;
        min-height: 100svh;
        border: 0;
        border-radius: 0;
        box-shadow: none;
        background: transparent;
        padding: var(--cog-space-400) var(--cog-space-300)
          calc(env(safe-area-inset-bottom, 0px) + var(--cog-space-500));
        align-content: end;
      }
    }
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
