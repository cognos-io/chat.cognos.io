import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { EMPTY, catchError } from 'rxjs';

import { TranslocoModule } from '@jsverse/transloco';
import { filterNil } from 'ngxtension/filter-nil';

import {
  CognosAuthPageComponent,
  CognosButtonComponent,
  CognosLozengeComponent,
} from '@cognos/ui-angular';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';

import { AuthService } from '@services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CognosAuthPageComponent,
    ReactiveFormsModule,
    RouterLink,
    TranslocoModule,
    CognosButtonComponent,
    CognosLozengeComponent,
    CognosLogoComponent,
    LoadingIndicatorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-auth-page>
      <ng-container *transloco="let t">
        <app-cognos-logo class="auth-page__logo" palette="dark"></app-cognos-logo>
        <div class="auth-page__eyebrow">
          <cog-lozenge tone="green">{{ t('auth.register.beta') }}</cog-lozenge>
        </div>
        <h1 class="auth-page__title">{{ t('auth.register.title') }}</h1>
        <p class="auth-page__lead">{{ t('auth.register.lead') }}</p>

        <form
          class="auth-page__form"
          [formGroup]="registerForm"
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
            @if (
              registerForm.controls.email.touched && registerForm.controls.email.invalid
            ) {
              <span class="register__field-msg register__field-msg--error">
                {{ t('auth.register.hints.emailInvalid') }}
              </span>
            }
          </label>

          <label class="auth-page__field" for="password">
            <span class="auth-page__label">{{ t('common.password') }}</span>
            <input
              id="password"
              class="auth-page__input"
              formControlName="password"
              type="password"
              autocomplete="new-password"
              [placeholder]="t('auth.register.passwordPlaceholder')"
            />
            @switch (passwordHintState()) {
              @case ('ok') {
                <span class="register__field-msg register__field-msg--ok">
                  {{ t('auth.register.hints.passwordOk') }}
                </span>
              }
              @case ('error') {
                <span class="register__field-msg register__field-msg--error">
                  {{ t('auth.register.hints.passwordLength') }}
                </span>
              }
              @default {
                <span class="register__field-msg register__field-msg--hint">
                  {{ t('auth.register.hints.passwordLength') }}
                </span>
              }
            }
          </label>

          <cog-button
            appearance="primary"
            [fullWidth]="true"
            size="lg"
            type="submit"
            [disabled]="loading() || registerForm.invalid"
          >
            @if (loading()) {
              <span class="auth-page__loading-copy">
                <app-loading-indicator></app-loading-indicator>
                {{ t('auth.register.creating') }}
              </span>
            } @else {
              {{ t('auth.register.submit') }}
            }
          </cog-button>
        </form>

        <p class="auth-page__legal">
          {{ t('auth.register.legalPrefix') }}
          <a
            href="https://cognos.io/privacy-policy-and-terms/"
            rel="noopener noreferrer"
            target="_blank"
            >{{ t('common.privacyTerms') }}</a
          >.
        </p>

        <p class="auth-page__switch">
          {{ t('auth.register.haveAccount') }}
          <a routerLink="/auth/login">{{ t('auth.register.login') }}</a>
        </p>
      </ng-container>
    </cog-auth-page>
  `,
  styles: `
    .register__field-msg {
      margin-top: var(--cog-space-050);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .register__field-msg--hint {
      color: var(--cog-text-subtle);
    }

    .register__field-msg--error {
      color: var(--cog-danger-text);
    }

    .register__field-msg--ok {
      color: var(--cog-success-text);
    }
  `,
})
export class RegisterComponent {
  readonly authService = inject(AuthService);
  private readonly _fb = inject(FormBuilder);
  private readonly _router = inject(Router);

  readonly loading = signal(false);

  readonly registerForm = this._fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(12)]],
  });

  // Live password-length feedback: neutral hint while empty, error while too
  // short, satisfied once the 12-character minimum is met.
  protected passwordHintState(): 'idle' | 'error' | 'ok' {
    const length = this.registerForm.controls.password.value.length;
    if (length === 0) {
      return 'idle';
    }
    return length >= 12 ? 'ok' : 'error';
  }

  constructor() {
    this.authService.user$.pipe(takeUntilDestroyed(), filterNil()).subscribe((user) => {
      if (user) {
        this._router.navigate(['/']);
      }
    });
  }

  onSubmit(): void {
    if (this.registerForm.invalid || this.loading()) {
      return;
    }

    const { email, password } = this.registerForm.getRawValue();
    this.loading.set(true);

    this.authService
      .register(email, password)
      .pipe(
        catchError(() => {
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.loading.set(false);
      });
  }
}
