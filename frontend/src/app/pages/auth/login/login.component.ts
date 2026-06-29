import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { EMPTY, catchError } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { filterNil } from 'ngxtension/filter-nil';

import { CognosAuthPageComponent, CognosButtonComponent } from '@cognos/ui-angular';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';
import { ErrorService } from '@app/services/error.service';

import { AuthService } from '@services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CognosAuthPageComponent,
    ReactiveFormsModule,
    RouterLink,
    TranslocoModule,
    CognosButtonComponent,
    CognosLogoComponent,
    LoadingIndicatorComponent,
  ],
  template: `
    <cog-auth-page>
      <ng-container *transloco="let t">
        <app-cognos-logo class="auth-page__logo" palette="dark"></app-cognos-logo>
        <h1 class="auth-page__title">{{ t('auth.login.title') }}</h1>
        <p class="auth-page__lead">{{ t('auth.login.lead') }}</p>

        @if (authService.status() === 'mfa_required') {
          <form
            class="auth-page__form"
            [formGroup]="mfaForm"
            (ngSubmit)="onSubmitMfa()"
          >
            <p class="auth-page__lead">
              {{
                mfaMode() === 'totp'
                  ? t('auth.mfa.totpPrompt')
                  : t('auth.mfa.recoveryPrompt')
              }}
            </p>

            <label class="auth-page__field" for="mfa-code">
              <span class="auth-page__label">
                {{
                  mfaMode() === 'totp'
                    ? t('auth.mfa.codeLabel')
                    : t('auth.mfa.recoveryLabel')
                }}
              </span>
              <input
                id="mfa-code"
                class="auth-page__input"
                formControlName="code"
                [attr.inputmode]="mfaMode() === 'totp' ? 'numeric' : 'text'"
                autocomplete="one-time-code"
                [placeholder]="mfaMode() === 'totp' ? '123456' : 'XXXXX-XXXXX'"
              />
            </label>

            <label class="auth-page__remember">
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
                <span class="auth-page__loading-copy">
                  <app-loading-indicator></app-loading-indicator>
                  {{ t('auth.mfa.verifying') }}
                </span>
              } @else {
                {{ t('auth.mfa.verify') }}
              }
            </cog-button>

            @if (mfaError()) {
              <p class="auth-page__hint">{{ mfaError() }}</p>
            }

            <p class="auth-page__switch">
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
            <p class="auth-page__switch">
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
          <form class="auth-page__form" [formGroup]="loginForm" (ngSubmit)="onSubmit()">
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

            <label class="auth-page__field" for="password">
              <span class="auth-page__label">{{ t('common.password') }}</span>
              <input
                id="password"
                class="auth-page__input"
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
                <span class="auth-page__loading-copy">
                  <app-loading-indicator></app-loading-indicator>
                  {{ t('auth.login.signingIn') }}
                </span>
              } @else {
                {{ t('auth.login.submit') }}
              }
            </cog-button>
          </form>

          @if (authService.status() === 'error') {
            <p class="auth-page__hint">{{ t('auth.login.error') }}</p>
          }

          <p class="auth-page__switch">
            <a routerLink="/auth/forgot-password">{{ t('auth.login.forgot') }}</a>
          </p>
          <p class="auth-page__switch">
            {{ t('auth.login.needAccount') }}
            <a routerLink="/auth/register">{{ t('auth.login.register') }}</a>
          </p>
        }

        <p class="auth-page__legal">
          {{ t('auth.login.legalPrefix') }}
          <a
            href="https://cognos.io/privacy-policy-and-terms/"
            rel="noopener noreferrer"
            target="_blank"
            >{{ t('common.privacyTerms') }}</a
          >.
        </p>
      </ng-container>
    </cog-auth-page>
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
