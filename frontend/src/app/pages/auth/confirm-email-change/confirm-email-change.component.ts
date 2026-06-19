import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { CognosButtonComponent, CognosTextFieldComponent } from '@cognos/ui-angular';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';

import { AuthService } from '@services/auth.service';

type ConfirmState = 'form' | 'submitting' | 'success' | 'error' | 'missing-token';

@Component({
  selector: 'app-confirm-email-change',
  standalone: true,
  imports: [
    RouterLink,
    CognosLogoComponent,
    CognosTextFieldComponent,
    CognosButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth-page">
      <section class="auth-page__card">
        <app-cognos-logo class="auth-page__logo" palette="dark"></app-cognos-logo>
        <h1 class="auth-page__title">Confirm your new email</h1>

        @switch (state()) {
          @case ('form') {
            <p class="auth-page__lead">
              Enter your password to finish changing your email. Your password only
              signs you in — this never affects your encrypted chats.
            </p>
            <div class="auth-page__field">
              <span class="auth-page__label">Password</span>
              <cog-text-field
                ariaLabel="Password"
                type="password"
                [value]="password()"
                (valueChange)="password.set($event)"
              />
            </div>
            <cog-button
              appearance="primary"
              [disabled]="password().length === 0"
              (click)="confirm()"
            >
              Confirm email change
            </cog-button>
          }
          @case ('submitting') {
            <p class="auth-page__lead">Confirming your new email…</p>
          }
          @case ('success') {
            <p class="auth-page__success">
              Your email has been changed. Please sign in again with your new email.
            </p>
            <a routerLink="/auth/login" class="auth-page__switch">Continue to log in</a>
          }
          @case ('error') {
            <p class="auth-page__hint">
              That link didn't work — it may have expired or already been used, or the
              password was incorrect.
            </p>
            <a routerLink="/auth/login" class="auth-page__switch">Go to log in</a>
          }
          @case ('missing-token') {
            <p class="auth-page__hint">
              This confirmation link is missing its token. Try clicking the link from
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
    .auth-page__hint {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
      text-wrap: pretty;
    }

    .auth-page__field {
      display: grid;
      gap: var(--cog-space-050);
    }

    .auth-page__label {
      color: var(--cog-text);
      font-size: var(--cog-fs-body-sm);
      font-weight: var(--cog-fw-semibold);
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
      font-size: var(--cog-fs-body);
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
export class ConfirmEmailChangeComponent implements OnInit {
  private readonly _authService = inject(AuthService);
  private readonly _route = inject(ActivatedRoute);

  readonly state = signal<ConfirmState>('form');
  readonly password = signal('');

  private _token = '';

  ngOnInit(): void {
    const token = this._route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.state.set('missing-token');
      return;
    }
    this._token = token;
  }

  confirm(): void {
    if (this.state() === 'submitting' || this.password().length === 0) {
      return;
    }

    this.state.set('submitting');
    this._authService.confirmEmailChange(this._token, this.password()).subscribe({
      next: () => this.state.set('success'),
      error: () => this.state.set('error'),
    });
  }
}
