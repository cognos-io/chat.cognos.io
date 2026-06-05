import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { CognosButtonComponent, CognosDialogSurfaceComponent } from '@cognos/ui-angular';

import { environment } from '@environments/environment';

import { VaultService } from '../../services/vault.service';

@Component({
  selector: 'app-vault-password-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, CognosDialogSurfaceComponent, CognosButtonComponent],
  template: `
    <cog-dialog-surface
      title="Vault locked"
      [footer]="false"
      [dismissible]="false"
    >
      <div class="vault-password-dialog">
        <div class="vault-password-dialog__copy">
          @if (vaultService.isNewKeyPair()) {
            <p>
              To secure your vault we require you to enter a vault password used to
              encrypt and decrypt your chats. This is different from your login
              password.
            </p>
            <p>
              Make sure you keep this safe as you will not be able to access your chats
              without it.
            </p>
          } @else {
            <p>
              Enter your vault password to unlock your chats. Your vault password will
              never leave your device.
            </p>
          }
        </div>

        <form
          class="vault-password-dialog__form"
          [formGroup]="vaultPasswordForm"
          (ngSubmit)="submit()"
        >
          <label class="vault-password-dialog__field" for="vault-password">
            <span class="vault-password-dialog__label">Vault password</span>
            <input
              id="vault-password"
              class="vault-password-dialog__input"
              formControlName="vaultPassword"
              type="password"
            />
            <span class="vault-password-dialog__hint"
              >This is different from your login password</span
            >
            @if (vaultPasswordForm.get('vaultPassword')?.hasError('required')) {
              <span class="vault-password-dialog__error">Vault password is required</span>
            }
          </label>

          <cog-button
            appearance="primary"
            type="submit"
            [disabled]="!vaultPasswordForm.valid"
          >
            @if (vaultService.isNewKeyPair()) {
              Create vault
            } @else {
              Unlock vault
            }
          </cog-button>
        </form>
      </div>
    </cog-dialog-surface>
  `,
  styles: `
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

    .vault-password-dialog__input:focus {
      border-color: var(--cog-brand);
      background: var(--cog-input-bg-focus);
    }

    .vault-password-dialog__hint {
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .vault-password-dialog__error {
      color: var(--cog-danger);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }
  `,
})
export class VaultPasswordDialogComponent {
  vaultService = inject(VaultService);
  fb = inject(FormBuilder);

  vaultPasswordForm = this.fb.group({
    vaultPassword: [
      environment.isDevelopment ? environment.localVaultPassword : '',
      [Validators.required, Validators.minLength(8)],
    ],
  });

  submit() {
    this.vaultService.rawVaultPassword$.next(
      this.vaultPasswordForm.value.vaultPassword ?? '',
    );
  }
}
