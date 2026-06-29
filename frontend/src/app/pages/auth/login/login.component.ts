import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { EMPTY, catchError } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { filterNil } from 'ngxtension/filter-nil';

import { CognosButtonComponent } from '@cognos/ui-angular';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';
import { ErrorService } from '@app/services/error.service';

import { AuthService } from '@services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoModule,
    CognosButtonComponent,
    CognosLogoComponent,
    LoadingIndicatorComponent,
  ],
  template: `
    <div class="login-page">
      <section class="login-page__card" *transloco="let t">
        <app-cognos-logo class="login-page__logo" palette="dark"></app-cognos-logo>
        <h1 class="login-page__title">{{ t('auth.login.title') }}</h1>
        <p class="login-page__lead">{{ t('auth.login.lead') }}</p>

        @if (authService.status() === 'mfa_required') {
          <form
            class="login-page__form"
            [formGroup]="mfaForm"
            (ngSubmit)="onSubmitMfa()"
          >
            <p class="login-page__lead">
              {{
                mfaMode() === 'totp'
                  ? t('auth.mfa.totpPrompt')
                  : t('auth.mfa.recoveryPrompt')
              }}
            </p>

            <label class="login-page__field" for="mfa-code">
              <span class="login-page__label">
                {{
                  mfaMode() === 'totp'
                    ? t('auth.mfa.codeLabel')
                    : t('auth.mfa.recoveryLabel')
                }}
              </span>
              <input
                id="mfa-code"
                class="login-page__input"
                formControlName="code"
                [attr.inputmode]="mfaMode() === 'totp' ? 'numeric' : 'text'"
                autocomplete="one-time-code"
                [placeholder]="mfaMode() === 'totp' ? '123456' : 'XXXXX-XXXXX'"
              />
            </label>

            <label class="login-page__remember">
              <input type="checkbox" formControlName="rememberDevice" />
              <span>{{ t('auth.mfa.rememberDevice') }}</span>
            </label>

            <cog-button
              appearance="primary"
              [fullWidth]="true"
              size="lg"
              type="submit"
              [disabled]="mfaSubmitting() || mfaForm.invalid"
            >
              @if (mfaSubmitting()) {
                <span class="login-page__loading-copy">
                  <app-loading-indicator></app-loading-indicator>
                  {{ t('auth.mfa.verifying') }}
                </span>
              } @else {
                {{ t('auth.mfa.verify') }}
              }
            </cog-button>

            @if (mfaError()) {
              <p class="login-page__hint">{{ mfaError() }}</p>
            }

            <p class="login-page__switch">
              <a
                role="button"
                tabindex="0"
                (click)="toggleMode()"
                (keyup.enter)="toggleMode()"
              >
                {{
                  mfaMode() === 'totp'
                    ? t('auth.mfa.useRecovery')
                    : t('auth.mfa.useApp')
                }}
              </a>
            </p>
            <p class="login-page__switch">
              <a
                role="button"
                tabindex="0"
                (click)="backToLogin()"
                (keyup.enter)="backToLogin()"
              >
                {{ t('auth.mfa.back') }}
              </a>
            </p>
          </form>
        } @else {
          <form
            class="login-page__form"
            [formGroup]="loginForm"
            (ngSubmit)="onSubmit()"
          >
            <label class="login-page__field" for="email">
              <span class="login-page__label">{{ t('common.email') }}</span>
              <input
                id="email"
                class="login-page__input"
                formControlName="email"
                type="email"
                autocomplete="email"
                [placeholder]="t('common.emailPlaceholder')"
              />
            </label>

            <label class="login-page__field" for="password">
              <span class="login-page__label">{{ t('common.password') }}</span>
              <input
                id="password"
                class="login-page__input"
                formControlName="password"
                type="password"
                autocomplete="current-password"
                [placeholder]="t('common.passwordPlaceholder')"
              />
            </label>

            <cog-button
              appearance="primary"
              [fullWidth]="true"
              size="lg"
              type="submit"
              [disabled]="loading() || loginForm.invalid"
            >
              @if (loading()) {
                <span class="login-page__loading-copy">
                  <app-loading-indicator></app-loading-indicator>
                  {{ t('auth.login.signingIn') }}
                </span>
              } @else {
                {{ t('auth.login.submit') }}
              }
            </cog-button>
          </form>

          @if (authService.status() === 'error') {
            <p class="login-page__hint">{{ t('auth.login.error') }}</p>
          }

          <p class="login-page__switch">
            <a routerLink="/auth/forgot-password">{{ t('auth.login.forgot') }}</a>
          </p>
          <p class="login-page__switch">
            {{ t('auth.login.needAccount') }}
            <a routerLink="/auth/register">{{ t('auth.login.register') }}</a>
          </p>
        }

        <p class="login-page__legal">
          {{ t('auth.login.legalPrefix') }}
          <a
            href="https://cognos.io/privacy-policy-and-terms/"
            rel="noopener noreferrer"
            target="_blank"
            >{{ t('common.privacyTerms') }}</a
          >.
        </p>
      </section>
    </div>
  `,
  styles: `
    .login-page {
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

    .login-page__card {
      display: grid;
      width: min(100%, 460px);
      gap: var(--cog-space-150);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      box-shadow: var(--cog-shadow-raised);
      padding: var(--cog-space-400);
    }

    .login-page__form,
    .login-page__field {
      display: grid;
      gap: var(--cog-space-150);
    }

    .login-page__logo {
      height: 28px;
    }

    .login-page__title,
    .login-page__lead,
    .login-page__hint,
    .login-page__legal,
    .login-page__switch {
      margin: 0;
    }

    .login-page__title {
      color: var(--cog-text);
      font-size: var(--cog-fs-display);
      font-weight: var(--cog-fw-display);
      line-height: var(--cog-lh-display);
      letter-spacing: var(--cog-ls-display);
      text-wrap: balance;
    }

    .login-page__lead,
    .login-page__legal,
    .login-page__hint,
    .login-page__switch {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
      text-wrap: pretty;
    }

    .login-page__label {
      color: var(--cog-text);
      font-size: var(--cog-fs-body-sm);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-body-sm);
    }

    .login-page__input {
      min-height: 44px;
      border: 2px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-input-bg);
      color: var(--cog-text);
      padding: 0 var(--cog-space-150);
      font: inherit;
      outline: 0;
    }

    .login-page__input:focus {
      border-color: var(--cog-brand);
      background: var(--cog-input-bg-focus);
    }

    .login-page__legal a,
    .login-page__switch a {
      color: var(--cog-link);
    }

    .login-page__remember {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-100);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      line-height: var(--cog-lh-body-sm);
      cursor: pointer;
    }

    .login-page__switch a[role='button'] {
      cursor: pointer;
    }

    .login-page__loading-copy {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-100);
    }

    .login-page__loading-copy app-loading-indicator {
      padding: 0;
    }

    @media (max-width: 640px) {
      .login-page {
        place-items: stretch;
        padding: 0;
      }

      .login-page__card {
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
export class LoginComponent {
  readonly authService: AuthService = inject(AuthService);
  private readonly _errorService: ErrorService = inject(ErrorService);
  private readonly _fb = inject(FormBuilder);
  private readonly _router: Router = inject(Router);
  private readonly _transloco = inject(TranslocoService);
  private readonly _destroyRef = inject(DestroyRef);

  readonly loginForm = this._fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  readonly mfaForm = this._fb.nonNullable.group({
    code: ['', [Validators.required]],
    rememberDevice: [false],
  });

  readonly mfaMode = signal<'totp' | 'recovery'>('totp');
  readonly mfaSubmitting = signal(false);
  readonly mfaError = signal('');

  loading = computed(() => this.authService.status() === 'authenticating');

  constructor() {
    this.authService.user$
      .pipe(
        catchError(() => {
          this._errorService.alert(this._transloco.translate('errors.fetchUser'));
          return EMPTY;
        }),
        takeUntilDestroyed(),
        filterNil(),
      )
      .subscribe((user) => {
        if (user) {
          this._router.navigate(['/']);
        }
      });
  }

  onSubmit() {
    if (this.loginForm.invalid || this.loading()) {
      return;
    }

    this.authService.login$.next(this.loginForm.getRawValue());
  }

  onSubmitMfa() {
    if (this.mfaForm.invalid || this.mfaSubmitting()) {
      return;
    }

    this.mfaError.set('');
    this.mfaSubmitting.set(true);

    const { code, rememberDevice } = this.mfaForm.getRawValue();
    this.authService
      .completeMfa(this.mfaMode(), code.trim(), rememberDevice)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        // Success navigates via the user$ subscription above.
        error: () => {
          this.mfaSubmitting.set(false);
          this.mfaError.set(this._transloco.translate('auth.mfa.invalid'));
          this.mfaForm.controls.code.reset('');
        },
        complete: () => this.mfaSubmitting.set(false),
      });
  }

  toggleMode() {
    this.mfaMode.update((mode) => (mode === 'totp' ? 'recovery' : 'totp'));
    this.mfaError.set('');
    this.mfaForm.controls.code.reset('');
  }

  backToLogin() {
    this.mfaError.set('');
    this.mfaForm.reset({ code: '', rememberDevice: false });
    this.loginForm.controls.password.reset('');
    this.authService.resetMfaChallenge();
  }
}
