import { Component, computed, inject } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';

import {
  CognosButtonComponent,
  CognosDialogSurfaceComponent,
} from '@cognos/ui-angular';

import { environment } from '@environments/environment';

import { VaultService } from '../../services/vault.service';

const requireAccountKeyForNewUsers = (
  control: AbstractControl,
): ValidationErrors | null => {
  const accountKeySaved = control.get('accountKeySaved')?.value;
  return accountKeySaved ? null : { accountKeySavedRequired: true };
};

@Component({
  selector: 'app-vault-password-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, CognosDialogSurfaceComponent, CognosButtonComponent],
  template: `
    <cog-dialog-surface [title]="title()" [footer]="false" [dismissible]="false">
      <div class="vault-password-dialog">
        <div class="vault-password-dialog__copy">
          @if (vaultService.isNewKeyPair()) {
            <p>
              Cognos generated a one-time Account Key for this encrypted backup. Save it
              now. New devices will need both your account password and this Account
              Key.
            </p>
            <div class="vault-password-dialog__account-key-card">
              <span class="vault-password-dialog__account-key-label">Account Key</span>
              <code class="vault-password-dialog__account-key-value">{{
                generatedAccountKey()
              }}</code>
              <cog-button appearance="default" type="button" (click)="copyAccountKey()">
                Copy Account Key
              </cog-button>
            </div>
            <p>
              Cognos never stores the plaintext Account Key. If you lose it, new-device
              unlock may be impossible.
            </p>
          } @else if (vaultService.requiresAccountKey()) {
            <p>
              Enter your account password and Account Key to unlock this device. Trusted
              devices can stay unlocked locally until you log out or clear browser
              storage.
            </p>
          } @else {
            <p>
              This account is still using the legacy password-only unlock flow while we
              migrate older encrypted backups to the Account Key model.
            </p>
          }
        </div>

        <form
          class="vault-password-dialog__form"
          [formGroup]="vaultForm"
          (ngSubmit)="submit()"
        >
          <label class="vault-password-dialog__field" for="account-password">
            <span class="vault-password-dialog__label">Account password</span>
            <input
              id="account-password"
              class="vault-password-dialog__input"
              formControlName="accountPassword"
              type="password"
              autocomplete="current-password"
            />
            @if (vaultForm.get('accountPassword')?.hasError('required')) {
              <span class="vault-password-dialog__error"
                >Account password is required</span
              >
            }
          </label>

          @if (!vaultService.isNewKeyPair() && vaultService.requiresAccountKey()) {
            <label class="vault-password-dialog__field" for="account-key">
              <span class="vault-password-dialog__label">Account Key</span>
              <input
                id="account-key"
                class="vault-password-dialog__input vault-password-dialog__input--code"
                formControlName="accountKey"
                type="text"
                autocomplete="off"
                spellcheck="false"
              />
              @if (
                vaultForm.hasError('accountKeyRequired') &&
                vaultForm.get('accountKey')?.touched
              ) {
                <span class="vault-password-dialog__error"
                  >Account Key is required</span
                >
              }
            </label>
          }

          @if (vaultService.isNewKeyPair()) {
            <label class="vault-password-dialog__checkbox-row">
              <input formControlName="accountKeySaved" type="checkbox" />
              <span>I saved this Account Key somewhere safe</span>
            </label>
            @if (vaultForm.hasError('accountKeySavedRequired')) {
              <span class="vault-password-dialog__error"
                >Please confirm that you saved your Account Key</span
              >
            }
          }

          <label class="vault-password-dialog__checkbox-row">
            <input formControlName="trustDevice" type="checkbox" />
            <span>Keep this device unlocked on this browser</span>
          </label>

          @if (vaultService.unlockError()) {
            <span class="vault-password-dialog__error">{{
              vaultService.unlockError()
            }}</span>
          }

          <cog-button appearance="primary" type="submit" [disabled]="vaultForm.invalid">
            @if (vaultService.isNewKeyPair()) {
              Create encrypted backup
            } @else {
              Unlock encrypted backup
            }
          </cog-button>
        </form>
      </div>
    </cog-dialog-surface>
  `,
  styles: `
    :host {
      display: block;
      inline-size: min(640px, calc(100vw - 32px));
    }

    .vault-password-dialog,
    .vault-password-dialog__copy,
    .vault-password-dialog__form,
    .vault-password-dialog__field {
      display: grid;
      gap: var(--cog-space-150);
    }

    .vault-password-dialog__copy p {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
      text-wrap: pretty;
    }

    .vault-password-dialog__account-key-card {
      display: grid;
      gap: var(--cog-space-100);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface-raised, var(--cog-surface));
      padding: var(--cog-space-150);
    }

    .vault-password-dialog__account-key-label {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .vault-password-dialog__account-key-value {
      overflow-wrap: anywhere;
      color: var(--cog-text);
      font-size: var(--cog-fs-body-sm);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-body-sm);
    }

    .vault-password-dialog__label {
      color: var(--cog-text);
      font-size: var(--cog-fs-body-sm);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-body-sm);
    }

    .vault-password-dialog__input {
      min-height: 40px;
      border: 2px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-input-bg);
      color: var(--cog-text);
      padding: 0 var(--cog-space-150);
      font: inherit;
      outline: 0;
    }

    .vault-password-dialog__input--code {
      font-family: var(--cog-font-mono, monospace);
      text-transform: uppercase;
    }

    .vault-password-dialog__input:focus {
      border-color: var(--cog-brand);
      background: var(--cog-input-bg-focus);
    }

    .vault-password-dialog__checkbox-row {
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      line-height: var(--cog-lh-body-sm);
    }

    .vault-password-dialog__checkbox-row input {
      margin: 0;
    }

    .vault-password-dialog__error {
      color: var(--cog-danger);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
      text-wrap: pretty;
    }
  `,
})
export class VaultPasswordDialogComponent {
  readonly vaultService = inject(VaultService);
  private readonly fb = inject(FormBuilder);

  readonly title = computed(() =>
    this.vaultService.isNewKeyPair() ? 'Secure your encrypted backup' : 'Unlock backup',
  );
  readonly generatedAccountKey = computed(
    () => this.vaultService.generatedAccountKey() ?? '',
  );

  readonly vaultForm = this.fb.group(
    {
      accountKey: [''],
      accountKeySaved: [false],
      accountPassword: [
        environment.isDevelopment ? environment.localVaultPassword : '',
        [Validators.required, Validators.minLength(8)],
      ],
      trustDevice: [true, [Validators.required]],
    },
    {
      validators: (control) => {
        if (this.vaultService.isNewKeyPair()) {
          return requireAccountKeyForNewUsers(control);
        }

        if (
          this.vaultService.requiresAccountKey() &&
          !control.get('accountKey')?.value?.trim()
        ) {
          return { accountKeyRequired: true };
        }

        return null;
      },
    },
  );

  async copyAccountKey(): Promise<void> {
    const accountKey = this.generatedAccountKey();
    if (!accountKey || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(accountKey);
  }

  submit() {
    if (this.vaultForm.invalid) {
      this.vaultForm.markAllAsTouched();
      return;
    }

    const { accountKey, accountPassword, trustDevice } = this.vaultForm.getRawValue();

    this.vaultService.clearUnlockError();
    this.vaultService.unlockRequest$.next({
      accountKey: accountKey ?? '',
      accountPassword: accountPassword ?? '',
      trustDevice: Boolean(trustDevice),
    });
  }
}
