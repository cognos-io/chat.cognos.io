import { DialogRef } from '@angular/cdk/dialog';
import { Component, computed, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';
import { Router } from '@angular/router';

import {
  CognosButtonComponent,
  CognosDialogSurfaceComponent,
  CognosIconComponent,
  CognosLozengeComponent,
  CognosToastService,
} from '@cognos/ui-angular';

import { environment } from '@environments/environment';

import { VaultService } from '../../services/vault.service';

const validateUnlockForm = (
  control: AbstractControl,
  isNewKeyPair: boolean,
  requiresPassword: boolean,
): ValidationErrors | null => {
  if (isNewKeyPair) {
    return control.get('accountKeySaved')?.value
      ? null
      : { accountKeySavedRequired: true };
  }

  const errors: ValidationErrors = {};
  if (!control.get('accountKey')?.value?.trim()) {
    errors['accountKeyRequired'] = true;
  }
  // The password is only part of the key for legacy v1 records; v2 unlock needs
  // the Account Key alone.
  if (requiresPassword && (control.get('accountPassword')?.value?.length ?? 0) < 8) {
    errors['accountPasswordRequired'] = true;
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

@Component({
  selector: 'app-vault-password-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    CognosDialogSurfaceComponent,
    CognosButtonComponent,
    CognosIconComponent,
    CognosLozengeComponent,
  ],
  template: `
    <cog-dialog-surface [title]="title()" [footer]="false" [dismissible]="false">
      <div class="vault-password-dialog">
        <div class="vault-password-dialog__copy">
          @if (!vaultService.isNewKeyPair() && vaultService.wasLocked()) {
            <div class="vault-password-dialog__status-card">
              <span class="vault-password-dialog__status-badge">
                <cog-icon name="lock" [size]="16" tone="brand"></cog-icon>
              </span>
              <div class="vault-password-dialog__status-copy">
                <div class="vault-password-dialog__status-title">
                  <cog-lozenge tone="blue">Locked</cog-lozenge>
                  <span>Account locked on this device</span>
                </div>
                <p>
                  Unlock to continue. This lock only clears local trusted access and
                  does not sign you out.
                </p>
              </div>
            </div>
          }

          @if (vaultService.isNewKeyPair()) {
            <p>
              Cognos generated a one-time Account Key for this encrypted backup. Save it
              now. It is the only thing that can decrypt your data — your password just
              signs you in, and a new device only needs this Account Key.
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
              Keep this Account Key private — anyone who has it can decrypt your data.
              Cognos never stores the plaintext Account Key, so if you lose it your data
              cannot be recovered.
            </p>
          } @else {
            @if (vaultService.requiresLegacyPassword()) {
              <p>Enter your account password and Account Key to unlock this device.</p>
            } @else {
              <p>Enter your Account Key to unlock this device.</p>
            }
            <p>
              After you unlock, this browser stays unlocked across refreshes and new
              tabs. You will need your Account Key again after locking the account,
              logging out, or clearing browser storage.
            </p>
          }
        </div>

        <form
          class="vault-password-dialog__form"
          [formGroup]="vaultForm"
          (ngSubmit)="submit()"
        >
          @if (vaultService.requiresLegacyPassword()) {
            <label class="vault-password-dialog__field" for="account-password">
              <span class="vault-password-dialog__label">Account password</span>
              <input
                id="account-password"
                class="vault-password-dialog__input"
                formControlName="accountPassword"
                type="password"
                autocomplete="current-password"
              />
              @if (vaultForm.hasError('accountPasswordRequired')) {
                <span class="vault-password-dialog__error"
                  >Account password is required</span
                >
              }
            </label>
          }

          @if (!vaultService.isNewKeyPair()) {
            <div class="vault-password-dialog__field">
              <div class="vault-password-dialog__field-head">
                <label class="vault-password-dialog__label" for="account-key">
                  Account Key
                </label>
                <button
                  class="vault-password-dialog__reveal"
                  type="button"
                  [attr.aria-pressed]="showAccountKey()"
                  (click)="toggleAccountKey()"
                >
                  {{ showAccountKey() ? 'Hide' : 'Show' }}
                </button>
              </div>
              <!-- A real password field: the Account Key is recovery-grade
                   secret material, so it must never land in the browser's
                   plaintext form-autofill history or be offered in a suggestion
                   dropdown. The Show/Hide control flips it to type=text on
                   demand; autocomplete is off so password managers don't
                   capture it. -->
              <input
                #accountKeyInput
                id="account-key"
                class="vault-password-dialog__input vault-password-dialog__input--code"
                formControlName="accountKey"
                [type]="showAccountKey() ? 'text' : 'password'"
                autocomplete="off"
                readonly
                spellcheck="false"
                (focus)="accountKeyInput.readOnly = false"
              />
              @if (
                vaultForm.hasError('accountKeyRequired') &&
                vaultForm.get('accountKey')?.touched
              ) {
                <span class="vault-password-dialog__error"
                  >Account Key is required</span
                >
              }
            </div>
          }

          @if (vaultService.isNewKeyPair()) {
            <label
              class="vault-password-dialog__checkbox-row vault-password-dialog__checkbox-row--acknowledge"
            >
              <input formControlName="accountKeySaved" type="checkbox" />
              <span>
                I have copied my Account Key to a safe place and acknowledge that if I
                lose it I will also not be able to access my account.
              </span>
            </label>
            @if (vaultForm.hasError('accountKeySavedRequired')) {
              <span class="vault-password-dialog__error"
                >Please confirm that you copied your Account Key and accept the recovery
                risk.</span
              >
            }
          }

          @if (vaultService.unlockError()) {
            <span class="vault-password-dialog__error">{{
              vaultService.unlockError()
            }}</span>
          }

          <div class="vault-password-dialog__actions">
            <cog-button appearance="subtle" type="button" (click)="logOut()">
              Log out
            </cog-button>
            <cog-button
              appearance="primary"
              type="submit"
              [disabled]="vaultForm.invalid"
            >
              @if (vaultService.isNewKeyPair()) {
                Create encrypted backup
              } @else {
                Unlock encrypted backup
              }
            </cog-button>
          </div>
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

    .vault-password-dialog__status-card {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--cog-space-125);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface-raised, var(--cog-surface));
      padding: var(--cog-space-150);
    }

    .vault-password-dialog__status-badge {
      display: inline-flex;
      width: 32px;
      height: 32px;
      align-items: center;
      justify-content: center;
      border-radius: var(--cog-radius-pill);
      background: var(--cog-info-bg);
    }

    .vault-password-dialog__status-copy {
      display: grid;
      gap: var(--cog-space-050);
    }

    .vault-password-dialog__status-copy p {
      margin: 0;
    }

    .vault-password-dialog__status-title {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--cog-space-075);
      color: var(--cog-text);
      font-size: var(--cog-fs-body-sm);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-body-sm);
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

    .vault-password-dialog__field-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--cog-space-100);
    }

    .vault-password-dialog__reveal {
      border: 0;
      background: transparent;
      padding: 0;
      color: var(--cog-link, var(--cog-brand));
      font: inherit;
      font-size: var(--cog-fs-body-sm);
      font-weight: var(--cog-fw-semibold);
      cursor: pointer;
    }

    .vault-password-dialog__reveal:hover {
      text-decoration: underline;
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

    .vault-password-dialog__checkbox-row--acknowledge {
      align-items: start;
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface-raised, var(--cog-surface));
      padding: var(--cog-space-125);
    }

    .vault-password-dialog__checkbox-row input {
      margin: 0;
    }

    .vault-password-dialog__checkbox-row--acknowledge input {
      margin-top: 2px;
    }

    .vault-password-dialog__error {
      color: var(--cog-danger);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
      text-wrap: pretty;
    }

    .vault-password-dialog__actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--cog-space-100);
    }
  `,
})
export class VaultPasswordDialogComponent {
  readonly vaultService = inject(VaultService);
  private readonly fb = inject(FormBuilder);
  private readonly toastService = inject(CognosToastService);
  private readonly router = inject(Router);
  private readonly dialogRef = inject(DialogRef, { optional: true });

  readonly title = computed(() => {
    if (this.vaultService.isNewKeyPair()) {
      return 'Secure your encrypted backup';
    }

    return this.vaultService.wasLocked() ? 'Account locked' : 'Unlock backup';
  });
  readonly generatedAccountKey = computed(
    () => this.vaultService.generatedAccountKey() ?? '',
  );

  // The Account Key is a recovery credential as sensitive as the password, so
  // the unlock field is masked by default. A show/hide toggle lets the user
  // verify a paste without leaving it on screen (shoulder-surfing / screen
  // share / screenshots).
  readonly showAccountKey = signal(false);

  readonly vaultForm = this.fb.group(
    {
      accountKey: [''],
      accountKeySaved: [false],
      accountPassword: [
        environment.isDevelopment ? environment.localVaultPassword : '',
      ],
    },
    {
      validators: (control) =>
        validateUnlockForm(
          control,
          this.vaultService.isNewKeyPair(),
          this.vaultService.requiresLegacyPassword(),
        ),
    },
  );

  async copyAccountKey(): Promise<void> {
    const accountKey = this.generatedAccountKey();
    if (!accountKey) {
      return;
    }

    const copied = await this.copyText(accountKey);
    if (!copied) {
      this.toastService.notify({
        title: 'Could not copy Account Key',
        msg: 'Select and store the Account Key manually before you continue.',
        tone: 'danger',
        icon: 'shield-x',
        duration: 4200,
      });
      return;
    }

    this.toastService.notify({
      title: 'Account Key copied',
      msg: 'Store it somewhere safe before you continue.',
      tone: 'success',
      icon: 'copy',
      duration: 3200,
    });
  }

  private async copyText(value: string): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        // Fall through to the document-based copy path below.
      }
    }

    if (typeof document === 'undefined') {
      return false;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, value.length);

    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }

  toggleAccountKey() {
    this.showAccountKey.update((shown) => !shown);
  }

  // Escape hatch when the device can't be unlocked (e.g. the encrypted backup
  // no longer exists). Closes the dialog and routes to the logout flow, which
  // clears the session and local vault state.
  logOut() {
    this.dialogRef?.close();
    void this.router.navigate(['', 'auth', 'logout']);
  }

  submit() {
    if (this.vaultForm.invalid) {
      this.vaultForm.markAllAsTouched();
      return;
    }

    const { accountKey, accountPassword } = this.vaultForm.getRawValue();

    this.vaultService.clearUnlockError();
    this.vaultService.unlockRequest$.next({
      accountKey: accountKey ?? '',
      accountPassword: accountPassword ?? '',
      trustDevice: true,
    });
  }
}
