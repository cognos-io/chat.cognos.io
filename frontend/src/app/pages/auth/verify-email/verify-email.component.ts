import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { EMPTY, catchError } from 'rxjs';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';

import { AuthService } from '@services/auth.service';

type VerificationState = 'verifying' | 'success' | 'error' | 'missing-token';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [RouterLink, CognosLogoComponent, LoadingIndicatorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth-page">
      <section class="auth-page__card">
        <app-cognos-logo class="auth-page__logo" palette="dark"></app-cognos-logo>
        <h1 class="auth-page__title">Verify your email</h1>

        @switch (state()) {
          @case ('verifying') {
            <p class="auth-page__lead">
              <app-loading-indicator></app-loading-indicator>
              Verifying your email…
            </p>
          }
          @case ('success') {
            <p class="auth-page__success">
              Your email is verified. Thanks for confirming.
            </p>
            <a routerLink="/auth/login" class="auth-page__switch">Continue to log in</a>
          }
          @case ('error') {
            <p class="auth-page__hint">
              That verification link didn't work — it may have expired or already been
              used.
            </p>
            <a routerLink="/auth/login" class="auth-page__switch">Go to log in</a>
          }
          @case ('missing-token') {
            <p class="auth-page__hint">
              This verification link is missing its token. Try clicking the link from
              your email again.
            </p>
            <a routerLink="/auth/login" class="auth-page__switch">Go to log in</a>
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
      display: inline-flex;
      gap: var(--cog-space-100);
      align-items: center;
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
export class VerifyEmailComponent implements OnInit {
  private readonly _authService = inject(AuthService);
  private readonly _route = inject(ActivatedRoute);

  readonly state = signal<VerificationState>('verifying');

  ngOnInit(): void {
    const token = this._route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.state.set('missing-token');
      return;
    }

    this._authService
      .confirmVerification(token)
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
