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

import { TranslocoModule } from '@jsverse/transloco';

import { CognosAuthPageComponent, CognosButtonComponent } from '@cognos/ui-angular';

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
        <h1 class="auth-page__title">{{ t('auth.reset.title') }}</h1>

        @switch (state()) {
          @case ('missing-token') {
            <p class="auth-page__hint" role="alert">
              {{ t('auth.reset.missingToken') }}
            </p>
            <a routerLink="/auth/forgot-password" class="auth-page__switch">
              {{ t('auth.reset.requestNewLink') }}
            </a>
          }
          @case ('success') {
            <p class="auth-page__success">{{ t('auth.reset.success') }}</p>
            <a routerLink="/auth/login" class="auth-page__switch">{{
              t('auth.reset.continueToLogin')
            }}</a>
          }
          @case ('error') {
            <p class="auth-page__hint" role="alert">{{ t('auth.reset.error') }}</p>
            <a routerLink="/auth/forgot-password" class="auth-page__switch">
              {{ t('auth.reset.requestNewLink') }}
            </a>
          }
          @default {
            <p class="auth-page__lead">{{ t('auth.reset.lead') }}</p>

            <form
              class="auth-page__form"
              [formGroup]="resetForm"
              (ngSubmit)="onSubmit()"
            >
              <label class="auth-page__field" for="password">
                <span class="auth-page__label">{{ t('auth.reset.newPassword') }}</span>
                <input
                  id="password"
                  class="auth-page__input"
                  formControlName="password"
                  type="password"
                  autocomplete="new-password"
                  [placeholder]="t('auth.register.passwordPlaceholder')"
                />
              </label>

              <label class="auth-page__field" for="passwordConfirm">
                <span class="auth-page__label">{{
                  t('auth.reset.confirmNewPassword')
                }}</span>
                <input
                  id="passwordConfirm"
                  class="auth-page__input"
                  formControlName="passwordConfirm"
                  type="password"
                  autocomplete="new-password"
                  [placeholder]="t('auth.reset.confirmPlaceholder')"
                />
              </label>

              @if (
                resetForm.hasError('mismatch') &&
                resetForm.get('passwordConfirm')?.dirty
              ) {
                <p class="auth-page__hint" role="alert">
                  {{ t('auth.reset.mismatch') }}
                </p>
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
                    {{ t('auth.reset.resetting') }}
                  </span>
                } @else {
                  {{ t('auth.reset.submit') }}
                }
              </cog-button>
            </form>

            <p class="auth-page__switch">
              <a routerLink="/auth/login">{{ t('auth.reset.backToLogin') }}</a>
            </p>
          }
        }
      </ng-container>
    </cog-auth-page>
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
