import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatInputModule } from '@angular/material/input';

import { environment } from '@environments/environment';

import { VaultService } from '../../services/vault.service';

@Component({
  selector: 'app-vault-password-dialog',
  standalone: true,
  imports: [MatButtonModule, ReactiveFormsModule, MatInputModule, MatDialogModule],
  template: `
    <h1 i18n mat-dialog-title>Vault locked</h1>
    <div class="vault-form-wrapper" mat-dialog-content>
      <div class="prose text-balance">
        @if (vaultService.isNewKeyPair()) {
          <p>
            To secure your vault we require you enter a vault password which will be
            used to encrypt and decrypt your chats. This is different from your login
            password. Make sure it is long and random to maximize security.
          </p>
          <p>
            Note: Make sure you keep this safe as you will not be able to access your
            chats without it.
          </p>
        } @else {
          <p>
            Enter your vault password to unlock your chats. Your vault password will
            never leave your device.
          </p>
        }
      </div>

      <form
        class="vault-form"
        [formGroup]="vaultPasswordForm"
        (ngSubmit)="
          vaultService.rawVaultPassword$.next(
            vaultPasswordForm.value.vaultPassword ?? ''
          )
        "
      >
        <mat-form-field>
          <mat-label i18n>Vault password</mat-label>
          <input type="password" matInput formControlName="vaultPassword" />
          <mat-hint i18n>This is different from your login password</mat-hint>
          @if (vaultPasswordForm.get('vaultPassword')?.hasError('required')) {
            <mat-error>Vault password is required</mat-error>
          }
        </mat-form-field>
        <button
          type="submit"
          mat-button
          color="primary"
          [disabled]="!vaultPasswordForm.valid"
        >
          @if (vaultService.isNewKeyPair()) {
            Create Vault
          } @else {
            Unlock Vault
          }
        </button>
      </form>
    </div>
  `,
  styles: `
    .vault-form-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }

    .vault-form {
      display: flex;
      width: 100%;
      flex-direction: column;
      gap: 1rem;
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
}
