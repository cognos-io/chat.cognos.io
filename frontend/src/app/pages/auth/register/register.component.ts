import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { EMPTY, catchError } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { filterNil } from 'ngxtension/filter-nil';

import { CognosAuthPageComponent, CognosButtonComponent } from '@cognos/ui-angular';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';

import { Analytics, signupSource } from '@services/analytics/analytics';
import { AuthService } from '@services/auth.service';

import { authRequestErrorKind } from '../auth-request-error';

@Component({
  selector: 'app-register',
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-auth-page>
      <ng-container *transloco="let t">
        <app-cognos-logo class="auth-page__logo"></app-cognos-logo>
        <h1 class="auth-page__title">{{ t('auth.register.title') }}</h1>
        <p class="auth-page__lead">{{ t('auth.register.lead') }}</p>

        <form
          class="auth-page__form"
          [formGroup]="registerForm"
          (ngSubmit)="onSubmit()"
        >
          <div class="auth-page__field">
            <label class="auth-page__label" for="email">{{ t('common.email') }}</label>
            <input
              id="email"
              class="auth-page__input"
              formControlName="email"
              type="email"
              autocomplete="email"
              [placeholder]="t('common.emailPlaceholder')"
              [attr.aria-describedby]="
                registerForm.controls.email.touched &&
                registerForm.controls.email.invalid
                  ? 'email-error'
                  : null
              "
            />
            @if (
              registerForm.controls.email.touched && registerForm.controls.email.invalid
            ) {
              <span
                id="email-error"
                class="register__field-msg register__field-msg--error"
              >
                {{ t('auth.register.hints.emailInvalid') }}
              </span>
            }
          </div>

          <div class="auth-page__field">
            <label class="auth-page__label" for="password">{{
              t('common.password')
            }}</label>
            <input
              id="password"
              class="auth-page__input"
              formControlName="password"
              type="password"
              autocomplete="new-password"
              [placeholder]="t('auth.register.passwordPlaceholder')"
              aria-describedby="password-hint"
            />
            @switch (passwordHintState()) {
              @case ('ok') {
                <span
                  id="password-hint"
                  class="register__field-msg register__field-msg--ok"
                >
                  {{ t('auth.register.hints.passwordOk') }}
                </span>
              }
              @case ('error') {
                <span
                  id="password-hint"
                  class="register__field-msg register__field-msg--error"
                >
                  {{ t('auth.register.hints.passwordLength') }}
                </span>
              }
              @default {
                <span
                  id="password-hint"
                  class="register__field-msg register__field-msg--hint"
                >
                  {{ t('auth.register.hints.passwordLength') }}
                </span>
              }
            }
          </div>

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

          @if (submitErrorKey()) {
            <p #submitError class="auth-page__hint" role="alert" tabindex="-1">
              {{ t(submitErrorKey()) }}
            </p>
          }
        </form>

        <p class="auth-page__legal">
          {{ t('auth.register.legalPrefix') }}
          <a [href]="legalUrl('terms')" rel="noopener noreferrer" target="_blank">{{
            t('common.terms')
          }}</a>
          {{ t('common.and') }}
          <a [href]="legalUrl('privacy')" rel="noopener noreferrer" target="_blank">{{
            t('common.privacyPolicy')
          }}</a
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
  private readonly _analytics = inject(Analytics);
  private readonly _transloco = inject(TranslocoService);
  private readonly _submitError = viewChild<ElementRef<HTMLElement>>('submitError');

  // Marketing attribution (docs/specs/product-analytics.md §6.5): the site's
  // CTAs append ?ref=<location>. Read once, kept in component memory only —
  // never stored — and mapped onto the closed source enum ('direct'/'other'
  // for absent/unknown), so it can never carry a free-form string.
  private readonly _signupSource = signupSource(
    inject(ActivatedRoute).snapshot.queryParamMap.get('ref'),
  );

  readonly loading = signal(false);
  readonly submitErrorKey = signal('');

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
    this.submitErrorKey.set('');
    this.loading.set(true);

    this.authService
      .register(email, password)
      .pipe(
        catchError((error: unknown) => {
          this.loading.set(false);
          this.submitErrorKey.set(
            `auth.register.errors.${authRequestErrorKind(error)}`,
          );
          setTimeout(() => this._submitError()?.nativeElement.focus());
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._analytics.track('signup_completed', { source: this._signupSource });
        this.loading.set(false);
      });
  }

  legalUrl(page: 'terms' | 'privacy'): string {
    const language = this._transloco.getActiveLang();
    const prefix = language && language !== 'en' ? `/${language}` : '';
    return `https://cognos.io${prefix}/${page}`;
  }
}
