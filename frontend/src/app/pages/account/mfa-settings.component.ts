import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import QRCode from 'qrcode';

import {
  CognosButtonComponent,
  CognosCardComponent,
  CognosListComponent,
  CognosListItemComponent,
  CognosToastService,
} from '@cognos/ui-angular';

import { MfaService, MfaStatus, TrustedDevice } from '@services/mfa.service';

type View =
  | 'loading'
  | 'overview'
  | 'enrolPassword'
  | 'enrolScan'
  | 'recovery'
  | 'regenerate'
  | 'disable';

// MfaSettingsComponent is an embeddable card (rendered inside the Account page,
// below "Change password") that manages authenticator-app MFA: enrolment,
// recovery codes, disable, and trusted devices. It renders as account-style
// card sections so it sits inline with the rest of the account settings.
@Component({
  selector: 'app-mfa-settings',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslocoModule,
    DatePipe,
    CognosButtonComponent,
    CognosCardComponent,
    CognosListComponent,
    CognosListItemComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <!-- Two-factor authentication -->
      <cog-card
        [heading]="t('settings.security.mfaHeading')"
        [subtitle]="t('settings.security.mfaDescription')"
      >
        @if (view() !== 'loading') {
          <span
            card-heading-actions
            class="security__badge"
            [class.security__badge--on]="status()?.enabled"
          >
            {{
              status()?.enabled
                ? t('settings.security.statusOn')
                : t('settings.security.statusOff')
            }}
          </span>
        }

        @switch (view()) {
          @case ('loading') {
            <p class="security__muted">…</p>
          }

          @case ('overview') {
            @if (!status()?.enabled) {
              <div class="security__actions">
                <cog-button appearance="primary" (click)="startEnrol()">
                  {{ t('settings.security.enable') }}
                </cog-button>
              </div>
            } @else {
              <p class="security__muted">
                {{
                  t('settings.security.recoveryRemaining', {
                    count: status()?.recoveryCodesRemaining ?? 0,
                  })
                }}
              </p>
              <div class="security__actions">
                <cog-button appearance="default" (click)="startRegenerate()">
                  {{ t('settings.security.regenerate') }}
                </cog-button>
                <cog-button appearance="danger" (click)="view.set('disable')">
                  {{ t('settings.security.disable') }}
                </cog-button>
              </div>
            }
          }

          @case ('enrolPassword') {
            <form
              class="security__form"
              [formGroup]="passwordForm"
              (ngSubmit)="submitEnrolPassword()"
            >
              <label class="security__field">
                <span class="security__label">{{
                  t('settings.security.passwordLabel')
                }}</span>
                <input
                  class="security__input"
                  type="password"
                  autocomplete="current-password"
                  formControlName="password"
                />
              </label>
              @if (error()) {
                <p class="security__error">{{ error() }}</p>
              }
              <div class="security__actions">
                <cog-button
                  appearance="primary"
                  type="submit"
                  [disabled]="busy() || passwordForm.invalid"
                >
                  {{ t('settings.security.continue') }}
                </cog-button>
                <cog-button appearance="subtle" type="button" (click)="cancel()">
                  {{ t('settings.security.cancel') }}
                </cog-button>
              </div>
            </form>
          }

          @case ('enrolScan') {
            <p class="security__muted">{{ t('settings.security.scanInstruction') }}</p>
            @if (qrDataUrl()) {
              <img
                class="security__qr"
                [src]="qrDataUrl()"
                [alt]="t('settings.security.qrAlt')"
                width="200"
                height="200"
              />
            }
            <p class="security__label">{{ t('settings.security.manualKeyLabel') }}</p>
            <code class="security__secret">{{ enrolSecret() }}</code>

            <form
              class="security__form"
              [formGroup]="confirmForm"
              (ngSubmit)="submitConfirm()"
            >
              <label class="security__field">
                <span class="security__label">{{
                  t('settings.security.codeLabel')
                }}</span>
                <input
                  class="security__input"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  placeholder="123456"
                  formControlName="code"
                />
              </label>
              @if (error()) {
                <p class="security__error">{{ error() }}</p>
              }
              <div class="security__actions">
                <cog-button
                  appearance="primary"
                  type="submit"
                  [disabled]="busy() || confirmForm.invalid"
                >
                  {{ t('settings.security.verifyEnable') }}
                </cog-button>
                <cog-button appearance="subtle" type="button" (click)="cancel()">
                  {{ t('settings.security.cancel') }}
                </cog-button>
              </div>
            </form>
          }

          @case ('recovery') {
            <h2 class="security__h3">{{ t('settings.security.recoveryTitle') }}</h2>
            <p class="security__muted">{{ t('settings.security.recoveryIntro') }}</p>
            <ul class="security__codes">
              @for (code of recoveryCodes(); track code) {
                <li>{{ code }}</li>
              }
            </ul>
            <div class="security__actions">
              <cog-button appearance="default" (click)="copyCodes()">
                {{
                  copied()
                    ? t('settings.security.copied')
                    : t('settings.security.copyCodes')
                }}
              </cog-button>
              <cog-button appearance="default" (click)="downloadCodes()">
                {{ t('settings.security.downloadCodes') }}
              </cog-button>
            </div>
            <div class="security__actions">
              <cog-button appearance="primary" (click)="finishRecovery()">
                {{ t('settings.security.recoveryDone') }}
              </cog-button>
            </div>
          }

          @case ('disable') {
            <h2 class="security__h3">{{ t('settings.security.disableHeading') }}</h2>
            <p class="security__muted">{{ t('settings.security.disableIntro') }}</p>
            <form
              class="security__form"
              [formGroup]="disableForm"
              (ngSubmit)="submitDisable()"
            >
              <label class="security__field">
                <span class="security__label">{{
                  t('settings.security.passwordLabel')
                }}</span>
                <input
                  class="security__input"
                  type="password"
                  autocomplete="current-password"
                  formControlName="password"
                />
              </label>
              <label class="security__field">
                <span class="security__label">{{
                  t('settings.security.codeLabel')
                }}</span>
                <input
                  class="security__input"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  placeholder="123456"
                  formControlName="code"
                />
              </label>
              @if (error()) {
                <p class="security__error">{{ error() }}</p>
              }
              <div class="security__actions">
                <cog-button
                  appearance="danger"
                  type="submit"
                  [disabled]="busy() || disableForm.invalid"
                >
                  {{ t('settings.security.confirmDisable') }}
                </cog-button>
                <cog-button appearance="subtle" type="button" (click)="cancel()">
                  {{ t('settings.security.cancel') }}
                </cog-button>
              </div>
            </form>
          }

          @case ('regenerate') {
            <h2 class="security__h3">{{ t('settings.security.regenerate') }}</h2>
            <p class="security__muted">{{ t('settings.security.regenerateHint') }}</p>
            <form
              class="security__form"
              [formGroup]="regenForm"
              (ngSubmit)="submitRegenerate()"
            >
              <label class="security__field">
                <span class="security__label">{{
                  t('settings.security.codeLabel')
                }}</span>
                <input
                  class="security__input"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  placeholder="123456"
                  formControlName="code"
                />
              </label>
              @if (error()) {
                <p class="security__error">{{ error() }}</p>
              }
              <div class="security__actions">
                <cog-button
                  appearance="primary"
                  type="submit"
                  [disabled]="busy() || regenForm.invalid"
                >
                  {{ t('settings.security.regenerate') }}
                </cog-button>
                <cog-button appearance="subtle" type="button" (click)="cancel()">
                  {{ t('settings.security.cancel') }}
                </cog-button>
              </div>
            </form>
          }
        }
      </cog-card>

      <!-- Trusted devices -->
      @if (status()?.enabled) {
        <cog-card
          [heading]="t('settings.security.devicesHeading')"
          [subtitle]="t('settings.security.devicesIntro')"
        >
          @if (devices().length === 0) {
            <p class="security__muted">{{ t('settings.security.devicesEmpty') }}</p>
          } @else {
            <cog-list>
              @for (device of devices(); track device.id) {
                <cog-list-item>
                  <div>
                    <span class="security__device-label">{{
                      device.label || '—'
                    }}</span>
                    <span class="security__muted">
                      {{
                        t('settings.security.added', {
                          date: device.createdAt | date: 'mediumDate',
                        })
                      }}
                      @if (device.lastUsedAt) {
                        ·
                        {{
                          t('settings.security.lastUsed', {
                            date: device.lastUsedAt | date: 'mediumDate',
                          })
                        }}
                      }
                    </span>
                  </div>
                  <cog-button appearance="subtle" (click)="revokeDevice(device.id)">
                    {{ t('settings.security.revoke') }}
                  </cog-button>
                </cog-list-item>
              }
            </cog-list>
          }
        </cog-card>
      }
    </ng-container>
  `,
  styles: `
    :host {
      display: contents;
    }
    .security__h3 {
      margin: 0;
      font-size: var(--cog-fs-h-sm);
      font-weight: var(--cog-fw-semibold);
      color: var(--cog-text);
    }
    .security__lead,
    .security__muted {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }
    .security__badge {
      flex: none;
      border-radius: var(--cog-radius-pill);
      padding: var(--cog-space-025) var(--cog-space-100);
      font-size: var(--cog-fs-body-sm);
      background: var(--cog-neutral-bg);
      color: var(--cog-text-subtle);
    }
    .security__badge--on {
      background: var(--cog-success-bg);
      color: var(--cog-success-text);
    }
    .security__form,
    .security__field {
      display: grid;
      gap: var(--cog-space-100);
    }
    .security__label {
      font-size: var(--cog-fs-body-sm);
      font-weight: var(--cog-fw-semibold);
      color: var(--cog-text);
    }
    .security__input {
      min-height: calc(var(--cog-space-500) + var(--cog-space-050));
      border: var(--cog-border-width-strong) solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-input-bg);
      color: var(--cog-text);
      padding: 0 var(--cog-space-150);
      font: inherit;
      outline: 0;
    }
    .security__input:focus {
      border-color: var(--cog-brand);
    }
    .security__actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--cog-space-100);
      margin-top: var(--cog-space-100);
    }
    .security__error {
      margin: 0;
      color: var(--cog-danger-text);
      font-size: var(--cog-fs-body-sm);
    }
    .security__qr {
      border-radius: var(--cog-radius-sm);
      background: #fff;
      padding: var(--cog-space-100);
      width: 200px;
      height: 200px;
    }
    .security__secret {
      display: inline-block;
      font-family: var(--cog-font-mono);
      font-size: var(--cog-fs-body);
      letter-spacing: 0.08em;
      background: var(--cog-input-bg);
      border: var(--cog-border-width) solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      padding: var(--cog-space-100) var(--cog-space-150);
      word-break: break-all;
    }
    .security__codes {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--cog-space-100);
      margin: 0;
      padding: var(--cog-space-150);
      list-style: none;
      background: var(--cog-input-bg);
      border: var(--cog-border-width) solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      font-family: var(--cog-font-mono);
      letter-spacing: 0.06em;
    }
    .security__device-label {
      display: block;
      font-weight: var(--cog-fw-semibold);
      color: var(--cog-text);
    }
    @media (max-width: 640px) {
      .security__codes {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class MfaSettingsComponent implements OnInit {
  private readonly _mfa = inject(MfaService);
  private readonly _fb = inject(FormBuilder);
  private readonly _transloco = inject(TranslocoService);
  private readonly _toast = inject(CognosToastService);
  private readonly _destroyRef = inject(DestroyRef);

  readonly view = signal<View>('loading');
  readonly status = signal<MfaStatus | null>(null);
  readonly devices = signal<TrustedDevice[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly enrolSecret = signal('');
  readonly qrDataUrl = signal('');
  readonly recoveryCodes = signal<string[]>([]);
  readonly copied = signal(false);

  readonly passwordForm = this._fb.nonNullable.group({
    password: ['', [Validators.required]],
  });
  readonly confirmForm = this._fb.nonNullable.group({
    code: ['', [Validators.required]],
  });
  readonly disableForm = this._fb.nonNullable.group({
    password: ['', [Validators.required]],
    code: ['', [Validators.required]],
  });
  readonly regenForm = this._fb.nonNullable.group({
    code: ['', [Validators.required]],
  });

  ngOnInit(): void {
    this.reload();
  }

  startEnrol(): void {
    this.error.set('');
    this.passwordForm.reset({ password: '' });
    this.view.set('enrolPassword');
  }

  submitEnrolPassword(): void {
    if (this.passwordForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const password = this.passwordForm.getRawValue().password;

    this._mfa
      .enrol(password)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: async (enrolment) => {
          this.enrolSecret.set(enrolment.secret);
          try {
            this.qrDataUrl.set(
              await QRCode.toDataURL(enrolment.otpauthUrl, { margin: 1 }),
            );
          } catch {
            this.qrDataUrl.set('');
          }
          this.confirmForm.reset({ code: '' });
          this.busy.set(false);
          this.view.set('enrolScan');
        },
        error: (err) => {
          this.busy.set(false);
          this.error.set(
            err?.status === 400
              ? this._transloco.translate('settings.security.wrongPassword')
              : this._transloco.translate('settings.security.genericError'),
          );
        },
      });
  }

  submitConfirm(): void {
    if (this.confirmForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');

    this._mfa
      .confirm(this.confirmForm.getRawValue().code.trim())
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (codes) => {
          this.recoveryCodes.set(codes);
          this.busy.set(false);
          this.view.set('recovery');
          this._toast.notify({
            title: this._transloco.translate('settings.security.title'),
            msg: this._transloco.translate('settings.security.enabledToast'),
            tone: 'success',
            duration: 4000,
          });
        },
        error: () => {
          this.busy.set(false);
          this.error.set(this._transloco.translate('settings.security.wrongCode'));
          this.confirmForm.reset({ code: '' });
        },
      });
  }

  finishRecovery(): void {
    this.recoveryCodes.set([]);
    this.copied.set(false);
    this.reload();
  }

  startRegenerate(): void {
    this.error.set('');
    this.regenForm.reset({ code: '' });
    this.view.set('regenerate');
  }

  submitRegenerate(): void {
    if (this.regenForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');

    this._mfa
      .regenerateRecoveryCodes(this.regenForm.getRawValue().code.trim())
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (codes) => {
          this.recoveryCodes.set(codes);
          this.busy.set(false);
          this.view.set('recovery');
          this.loadDevices();
        },
        error: () => {
          this.busy.set(false);
          this.error.set(this._transloco.translate('settings.security.wrongCode'));
          this.regenForm.reset({ code: '' });
        },
      });
  }

  submitDisable(): void {
    if (this.disableForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const { password, code } = this.disableForm.getRawValue();

    this._mfa
      .disable(password, code.trim())
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.disableForm.reset({ password: '', code: '' });
          this._toast.notify({
            title: this._transloco.translate('settings.security.title'),
            msg: this._transloco.translate('settings.security.disabledToast'),
            tone: 'success',
            duration: 4000,
          });
          this.reload();
        },
        error: (err) => {
          this.busy.set(false);
          this.error.set(
            err?.status === 400
              ? this._transloco.translate('settings.security.wrongCode')
              : this._transloco.translate('settings.security.genericError'),
          );
        },
      });
  }

  revokeDevice(id: string): void {
    this._mfa
      .revokeTrustedDevice(id)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => this.loadDevices(),
        error: () =>
          this.error.set(this._transloco.translate('settings.security.genericError')),
      });
  }

  cancel(): void {
    this.error.set('');
    this.view.set('overview');
  }

  async copyCodes(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.recoveryCodes().join('\n'));
      this.copied.set(true);
    } catch {
      /* clipboard unavailable */
    }
  }

  downloadCodes(): void {
    const blob = new Blob([this.recoveryCodes().join('\n') + '\n'], {
      type: 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cognos-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  private reload(): void {
    this._mfa
      .status()
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (status) => {
          this.status.set(status);
          this.view.set('overview');
          if (status.enabled) {
            this.loadDevices();
          }
        },
        error: () => {
          this.status.set({
            enabled: false,
            pendingEnrolment: false,
            recoveryCodesRemaining: 0,
          });
          this.view.set('overview');
        },
      });
  }

  private loadDevices(): void {
    this._mfa
      .listTrustedDevices()
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (devices) => this.devices.set(devices),
        error: () => this.devices.set([]),
      });
  }
}
