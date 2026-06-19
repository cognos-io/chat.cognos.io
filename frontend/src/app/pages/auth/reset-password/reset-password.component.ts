import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { EMPTY, catchError } from 'rxjs';

import { CognosButtonComponent } from '@cognos/ui-angular';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';

import { AuthService } from '@services/auth.service';

type ResetState = 'form' | 'submitting' | 'success' | 'error' | 'missing-token';

const passwordsMatch = (group: AbstractControl): ValidationErrors | null => {
  const password = group.get('password')?.value;
  const passwordConfirm = group.get('passwordConfirm')?.value;
  return password === passwordConfirm ? null : { mismatch: true };
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

        @switch (state()) {
          @case ('missing-token') {
            <p class="auth-page__hint">
              This reset link is missing its token. Request a new link and try again.
            </p>
            <a routerLink="/auth/forgot-password" class="auth-page__switch">
              Request a new link
            </a>
          }
          @case ('success') {
            <p class="auth-page__success">
              Your password has been reset. Your encrypted chats are untouched — your
              password only signs you in.
            </p>
            <a routerLink="/auth/login" class="auth-page__switch">Continue to log in</a>
          }
          @case ('error') {
            <p class="auth-page__hint">
              That reset link didn't work — it may have expired or already been used.
            </p>
            <a routerLink="/auth/forgot-password" class="auth-page__switch">
              Request a new link
            </a>
          }
          @default {
            <p class="auth-page__lead">
              Pick a new password of at least 12 characters. Your password is only used
              to sign in, so this won't affect your encrypted chats.
            </p>

            <form
              class="auth-page__form"
              [formGroup]="resetForm"
              (ngSubmit)="onSubmit()"
            >
              <label class="auth-page__field" for="password">
                <span class="auth-page__label">New password</span>
                <input
                  id="password"
                  class="auth-page__input"
                  formControlName="password"
                  type="password"
                  autocomplete="new-password"
                  placeholder="At least 12 characters"
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
                  placeholder="Re-enter your password"
                />
              </label>

              @if (
                resetForm.hasError('mismatch') &&
                resetForm.get('passwordConfirm')?.dirty
              ) {
                <p class="auth-page__hint">Passwords don't match.</p>
              }

              <cog-button
                appearance="primary"
                [fullWidth]="true"
                size="lg"
                type="submit"
                [disabled]="state() === 'submitting' || resetForm.invalid"
              >
                @if (state() === 'submitting') {
                  <span class="auth-page__loading-copy">
                    <app-loading-indicator></app-loading-indicator>
                    Resetting…
                  </span>
                } @else {
                  Reset password
                }
              </cog-button>
            </form>

            <p class="auth-page__switch">
              <a routerLink="/auth/login">Back to log in</a>
            </p>
          }
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

    .auth-page__switch {
      color: var(--cog-link);
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
export class ResetPasswordComponent implements OnInit {
  private readonly _authService = inject(AuthService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);

  readonly state = signal<ResetState>('form');

  private _token = '';

  readonly resetForm = this._fb.nonNullable.group(
    {
      password: ['', [Validators.required, Validators.minLength(12)]],
      passwordConfirm: ['', [Validators.required]],
    },
    { validators: passwordsMatch },
  );

  ngOnInit(): void {
    const token = this._route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.state.set('missing-token');
      return;
    }
    this._token = token;
  }

  onSubmit(): void {
    if (this.resetForm.invalid || this.state() === 'submitting') {
      return;
    }

    const { password, passwordConfirm } = this.resetForm.getRawValue();
    this.state.set('submitting');

    this._authService
      .confirmPasswordReset(this._token, password, passwordConfirm)
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
