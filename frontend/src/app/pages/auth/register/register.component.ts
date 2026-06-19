import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { EMPTY, catchError } from 'rxjs';

import { filterNil } from 'ngxtension/filter-nil';

import { CognosButtonComponent, CognosLozengeComponent } from '@cognos/ui-angular';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';

import { AuthService } from '@services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    CognosButtonComponent,
    CognosLozengeComponent,
    CognosLogoComponent,
    LoadingIndicatorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth-page">
      <section class="auth-page__card">
        <app-cognos-logo class="auth-page__logo" palette="dark"></app-cognos-logo>
        <div class="auth-page__eyebrow">
          <cog-lozenge tone="green">Private beta</cog-lozenge>
        </div>
        <h1 class="auth-page__title">Create your Cognos account</h1>
        <p class="auth-page__lead">
          Start with your email and password. Right after signup, Cognos will generate
          an Account Key for encrypted backup unlock on new devices.
        </p>

        <form
          class="auth-page__form"
          [formGroup]="registerForm"
          (ngSubmit)="onSubmit()"
        >
          <label class="auth-page__field" for="email">
            <span class="auth-page__label">Email</span>
            <input
              id="email"
              class="auth-page__input"
              formControlName="email"
              type="email"
              autocomplete="email"
              placeholder="you@example.com"
            />
          </label>

          <label class="auth-page__field" for="password">
            <span class="auth-page__label">Password</span>
            <input
              id="password"
              class="auth-page__input"
              formControlName="password"
              type="password"
              autocomplete="new-password"
              placeholder="At least 12 characters"
            />
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
                Creating account…
              </span>
            } @else {
              Create account
            }
          </cog-button>
        </form>

        <p class="auth-page__legal">
          By creating an account you agree to our
          <a
            href="https://cognos.io/privacy-policy-and-terms/"
            rel="noopener noreferrer"
            target="_blank"
            >Privacy Policy and Terms</a
          >.
        </p>

        <p class="auth-page__switch">
          Already have an account?
          <a routerLink="/auth/login">Log in</a>
        </p>
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
    .auth-page__legal,
    .auth-page__switch {
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
    .auth-page__legal,
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

    .auth-page__legal a,
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
export class RegisterComponent {
  readonly authService = inject(AuthService);
  private readonly _fb = inject(FormBuilder);
  private readonly _router = inject(Router);

  readonly loading = signal(false);

  readonly registerForm = this._fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(12)]],
  });

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
