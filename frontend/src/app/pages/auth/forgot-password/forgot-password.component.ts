import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [RouterLink, CognosLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth-page">
      <section class="auth-page__card">
        <app-cognos-logo class="auth-page__logo" palette="dark"></app-cognos-logo>
        <h1 class="auth-page__title">Password reset is unavailable</h1>
        <p class="auth-page__lead">
          Cognos currently blocks password reset because there is not yet a safe vault
          recovery flow for encrypted backups.
        </p>
        <p class="auth-page__lead">
          We do not want to offer a reset path that could leave your encrypted history
          inaccessible or weaken the current security model.
        </p>

        <p class="auth-page__switch">
          <a routerLink="/auth/login">Return to login</a>
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

    .auth-page__logo {
      height: 28px;
    }

    .auth-page__title,
    .auth-page__lead,
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
    .auth-page__switch {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
      text-wrap: pretty;
    }

    .auth-page__switch a {
      color: var(--cog-link);
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
export class ForgotPasswordComponent {}
