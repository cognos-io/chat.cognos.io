import { Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { EMPTY, catchError } from 'rxjs';

import { filterNil } from 'ngxtension/filter-nil';

import { CognosButtonComponent, CognosLozengeComponent } from '@cognos/ui-angular';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';
import { ProfilePictureComponent } from '@app/components/team/profile-picture/profile-picture.component';
import { ErrorService } from '@app/services/error.service';

import { AuthService } from '@services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    CognosButtonComponent,
    CognosLozengeComponent,
    CognosLogoComponent,
    LoadingIndicatorComponent,
    ProfilePictureComponent,
  ],
  template: `
    <div class="login-page">
      <section class="login-page__card">
        <div class="login-page__intro">
          <app-cognos-logo class="login-page__logo" palette="dark"></app-cognos-logo>
          <div class="login-page__eyebrow">
            <cog-lozenge tone="green">Private beta</cog-lozenge>
          </div>
          <h1 class="login-page__title">Get started with privacy-first AI</h1>
          <p class="login-page__lead">
            Chat with the latest models without giving up control of your data.
          </p>

          <form
            class="login-page__form"
            [formGroup]="loginForm"
            (ngSubmit)="onSubmit()"
          >
            <label class="login-page__field" for="email">
              <span class="login-page__label">Email</span>
              <input
                id="email"
                class="login-page__input"
                formControlName="email"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
              />
            </label>

            <label class="login-page__field" for="password">
              <span class="login-page__label">Password</span>
              <input
                id="password"
                class="login-page__input"
                formControlName="password"
                type="password"
                autocomplete="current-password"
                placeholder="••••••••"
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
                  Signing in…
                </span>
              } @else {
                Log in
              }
            </cog-button>
          </form>

          @if (authService.status() === 'error') {
            <p class="login-page__hint">
              We couldn't sign you in. Check your PocketBase user email and password and
              try again.
            </p>
          }

          <p class="login-page__legal">
            By signing up you agree to our
            <a
              href="https://cognos.io/privacy-policy-and-terms/"
              rel="noreferrer"
              target="_blank"
              >Privacy Policy and Terms</a
            >.
          </p>
        </div>

        <div class="login-page__founder">
          <div class="login-page__founder-copy">
            <p>Hi, I'm Ewan.</p>
            <p>
              I'm the founder and currently solo developer behind Cognos. I'm building
              it to help people use AI in a privacy-first way.
            </p>
            <p>
              You're accessing the beta so please expect some imperfections. In return,
              I'll cover the costs for now, although you can
              <a href="https://cognos.io/" rel="noreferrer" target="_blank"
                >subscribe</a
              >
              to contribute financially.
            </p>
            <p>
              If you'd like to talk to me about it, just
              <a href="mailto:ewan@cognos.io">drop me an email</a>.
            </p>
            <p>Thank you for trusting me, and happy hacking.</p>
          </div>

          <div class="login-page__portrait">
            <app-profile-picture
              profileName="Ewan Jones"
              profilePicturePath="assets/img/profile/profile_ewan--square.jpg"
            ></app-profile-picture>
          </div>
        </div>
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
      width: min(100%, 1080px);
      gap: var(--cog-space-400);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      box-shadow: var(--cog-shadow-raised);
      padding: var(--cog-space-400);
    }

    .login-page__intro,
    .login-page__founder,
    .login-page__founder-copy,
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
    .login-page__founder-copy p {
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
    .login-page__founder-copy p {
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
    .login-page__founder-copy a {
      color: var(--cog-link);
    }

    .login-page__loading-copy {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-100);
    }

    .login-page__loading-copy app-loading-indicator {
      padding: 0;
    }

    .login-page__portrait {
      width: min(160px, 100%);
    }

    @media (min-width: 960px) {
      .login-page__card {
        grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr);
        align-items: start;
      }
    }
  `,
})
export class LoginComponent {
  readonly authService: AuthService = inject(AuthService);
  private readonly _errorService: ErrorService = inject(ErrorService);
  private readonly _fb = inject(FormBuilder);
  private readonly _router: Router = inject(Router);

  readonly loginForm = this._fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  loading = computed(() => this.authService.status() === 'authenticating');

  constructor() {
    this.authService.user$
      .pipe(
        catchError(() => {
          this._errorService.alert(
            'Failed to fetch user, please refresh and try again.',
          );
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
}
