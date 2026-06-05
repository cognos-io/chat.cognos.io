import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { EMPTY, catchError } from 'rxjs';

import { CognosButtonComponent } from '@cognos/ui-angular';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';

import { AuthService } from '@services/auth.service';

const matchPassword = (control: AbstractControl): ValidationErrors | null => {
  const password = control.get('password')?.value;
  const confirm = control.get('passwordConfirm')?.value;
  return password && confirm && password !== confirm
    ? { passwordMismatch: true }
    : null;
};

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    CognosButtonComponent,
    CognosLogoComponent,
    LoadingIndicatorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth-page">
      <section class="auth-page__card">
        <app-cognos-logo class="auth-page__logo" palette="dark"></app-cognos-logo>
        <h1 class="auth-page__title">Choose a new password</h1>

        @if (!token()) {
          <p class="auth-page__hint">
            This reset link is missing its token. Request a new one from the
            <a routerLink="/auth/forgot-password">forgot password</a> page.
          </p>
        } @else if (success()) {
          <p class="auth-page__success">
            Your password has been updated. You can now log in with your new password.
          </p>
          <a routerLink="/auth/login" class="auth-page__switch">Continue to log in</a>
        } @else {
          <p class="auth-page__lead">Pick a password you haven't used elsewhere.</p>

          <form class="auth-page__form" [formGroup]="form" (ngSubmit)="onSubmit()">
            <label class="auth-page__field" for="password">
              <span class="auth-page__label">New password</span>
              <input
                id="password"
                class="auth-page__input"
                formControlName="password"
                type="password"
                autocomplete="new-password"
                placeholder="At least 8 characters"
              />
            </label>

            <label class="auth-page__field" for="passwordConfirm">
              <span class="auth-page__label">Confirm new password</span>
              <input
                id="passwordConfirm"
                class="auth-page__input"
                formControlName="passwordConfirm"
                type="password"
                autocomplete="new-password"
                placeholder="Repeat your password"
              />
            </label>

            @if (
              form.errors?.['passwordMismatch'] && form.get('passwordConfirm')?.touched
            ) {
              <p class="auth-page__hint">Passwords don't match.</p>
            }

            <cog-button
              appearance="primary"
              [fullWidth]="true"
              size="lg"
              type="submit"
              [disabled]="loading() || form.invalid"
            >
              @if (loading()) {
                <span class="auth-page__loading-copy">
                  <app-loading-indicator></app-loading-indicator>
                  Saving…
                </span>
              } @else {
                Update password
              }
            </cog-button>
          </form>
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
    .auth-page__hint,
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
    .auth-page__hint,
    .auth-page__switch {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
      text-wrap: pretty;
    }

    .auth-page__success {
      color: var(--cog-text);
      border: 1px solid var(--cog-success-border, var(--cog-border));
      background: var(--cog-success-bg);
      padding: var(--cog-space-200);
      border-radius: var(--cog-radius-sm);
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

    .auth-page__switch,
    .auth-page__hint a {
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
  `,
})
export class ResetPasswordComponent {
  private readonly _authService = inject(AuthService);
  private readonly _fb = inject(FormBuilder);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  readonly loading = signal(false);
  readonly success = signal(false);
  readonly token = signal<string | null>(
    this._route.snapshot.queryParamMap.get('token'),
  );

  readonly form = this._fb.nonNullable.group(
    {
      password: ['', [Validators.required, Validators.minLength(8)]],
      passwordConfirm: ['', [Validators.required]],
    },
    { validators: matchPassword },
  );

  onSubmit(): void {
    const token = this.token();
    if (!token || this.form.invalid || this.loading()) {
      return;
    }

    this.loading.set(true);
    const { password, passwordConfirm } = this.form.getRawValue();

    this._authService
      .confirmPasswordReset(token, password, passwordConfirm)
      .pipe(
        catchError(() => {
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.loading.set(false);
        this.success.set(true);
        setTimeout(() => this._router.navigate(['/auth/login']), 2500);
      });
  }
}
