import { DialogRef } from '@angular/cdk/dialog';
import { Component, computed, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';
import { Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosDialogSurfaceComponent,
  CognosIconComponent,
  CognosLozengeComponent,
  CognosToastService,
} from '@cognos/ui-angular';

import { LanguageSwitcherComponent } from '@app/components/language-switcher/language-switcher.component';

import { VaultService } from '../../services/vault.service';

// Plain-text "Emergency Kit" the user can download at onboarding. It is the
// 1Password-style printable record of the one secret they must never lose.
export function buildEmergencyKitText(accountKey: string, email?: string): string {
  const lines = [
    'COGNOS EMERGENCY KIT',
    '',
    'Your Account Key is the ONLY thing that can decrypt your data.',
    'Store it somewhere safe and private — a password manager, or printed and',
    'locked away. Anyone who has it can read your chats.',
    '',
  ];
  if (email) {
    lines.push(`Account: ${email}`);
  }
  lines.push(
    'Account Key:',
    accountKey,
    '',
    'What it does:',
    '- Unlocks your encrypted chats on a new device.',
    '- Your password only signs you in; this key decrypts your data.',
    '',
    'If you lose it:',
    '- Cognos never stores your Account Key, so your data cannot be recovered.',
    '',
    'Cognos · https://cognos.io',
  );
  return lines.join('\n');
}

const validateUnlockForm = (
  control: AbstractControl,
  isNewKeyPair: boolean,
): ValidationErrors | null => {
  if (isNewKeyPair) {
    return control.get('accountKeySaved')?.value
      ? null
      : { accountKeySavedRequired: true };
  }

  // Unlock derives from the Account Key alone, so it is the only required input.
  return control.get('accountKey')?.value?.trim() ? null : { accountKeyRequired: true };
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
    LanguageSwitcherComponent,
    TranslocoModule,
  ],
  template: `
    <cog-dialog-surface
      *transloco="let t"
      [title]="t(titleKey())"
      [footer]="false"
      [dismissible]="false"
    >
      <!-- In the title row: the user can't decrypt their saved preference yet,
           so the picker persists the choice locally (LanguageService →
           localStorage). -->
      <app-language-switcher cogDialogHeaderActions />

      <div class="vault-password-dialog">
        <div class="vault-password-dialog__copy">
          @if (!vaultService.isNewKeyPair() && vaultService.wasLocked()) {
            <div class="vault-password-dialog__status-card">
              <span class="vault-password-dialog__status-badge">
                <cog-icon name="lock" [size]="16" tone="brand"></cog-icon>
              </span>
              <div class="vault-password-dialog__status-copy">
                <div class="vault-password-dialog__status-title">
                  <cog-lozenge tone="blue">{{
                    t('dialogs.vaultPassword.lockedBadge')
                  }}</cog-lozenge>
                  <span>{{ t('dialogs.vaultPassword.lockedOnDevice') }}</span>
                </div>
                <p>{{ t('dialogs.vaultPassword.lockedBody') }}</p>
              </div>
            </div>
          }

          @if (vaultService.isNewKeyPair()) {
            <p>{{ t('dialogs.vaultPassword.newIntro') }}</p>
            <div class="vault-password-dialog__account-key-card">
              <span class="vault-password-dialog__account-key-label">{{
                t('dialogs.vaultPassword.accountKey')
              }}</span>
              <code class="vault-password-dialog__account-key-value">{{
                generatedAccountKey()
              }}</code>
              <div class="vault-password-dialog__account-key-actions">
                <cog-button
                  appearance="default"
                  type="button"
                  (click)="copyAccountKey()"
                >
                  {{ t('dialogs.vaultPassword.copyAccountKey') }}
                </cog-button>
                <cog-button
                  appearance="default"
                  type="button"
                  (click)="downloadEmergencyKit()"
                >
                  {{ t('dialogs.vaultPassword.downloadKit') }}
                </cog-button>
              </div>
            </div>
            <p>{{ t('dialogs.vaultPassword.newWarning') }}</p>
          } @else {
            <p>{{ t('dialogs.vaultPassword.unlockIntro') }}</p>
            <p>{{ t('dialogs.vaultPassword.unlockBody') }}</p>
          }
        </div>

        <form
          class="vault-password-dialog__form"
          [formGroup]="vaultForm"
          (ngSubmit)="submit()"
        >
          @if (!vaultService.isNewKeyPair()) {
            <div class="vault-password-dialog__field">
              <div class="vault-password-dialog__field-head">
                <label class="vault-password-dialog__label" for="account-key">
                  {{ t('dialogs.vaultPassword.accountKey') }}
                </label>
                <button
                  class="vault-password-dialog__reveal"
                  type="button"
                  [attr.aria-pressed]="showAccountKey()"
                  (click)="toggleAccountKey()"
                >
                  {{
                    showAccountKey()
                      ? t('dialogs.vaultPassword.hide')
                      : t('dialogs.vaultPassword.show')
                  }}
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
                <span class="vault-password-dialog__error">{{
                  t('dialogs.vaultPassword.accountKeyRequired')
                }}</span>
              }
            </div>
          }

          @if (vaultService.isNewKeyPair()) {
            <label
              class="vault-password-dialog__checkbox-row vault-password-dialog__checkbox-row--acknowledge"
            >
              <input formControlName="accountKeySaved" type="checkbox" />
              <span>{{ t('dialogs.vaultPassword.acknowledge') }}</span>
            </label>
            @if (vaultForm.hasError('accountKeySavedRequired')) {
              <span class="vault-password-dialog__error">{{
                t('dialogs.vaultPassword.acknowledgeRequired')
              }}</span>
            }
          }

          @if (vaultService.unlockError()) {
            <span class="vault-password-dialog__error">{{
              vaultService.unlockError()
            }}</span>
          }

          <div class="vault-password-dialog__actions">
            <cog-button appearance="subtle" type="button" (click)="logOut()">
              {{ t('dialogs.vaultPassword.logOut') }}
            </cog-button>
            <cog-button
              appearance="primary"
              type="submit"
              [disabled]="vaultForm.invalid"
            >
              @if (vaultService.isNewKeyPair()) {
                {{ t('dialogs.vaultPassword.createBackup') }}
              } @else {
                {{ t('dialogs.vaultPassword.unlockBackup') }}
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
      gap: var(--cog-space-150);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface-raised);
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
      background: var(--cog-surface-raised);
      padding: var(--cog-space-150);
    }

    .vault-password-dialog__account-key-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--cog-space-100);
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
      color: var(--cog-link);
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
      font-family: var(--cog-font-mono);
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
      background: var(--cog-surface-raised);
      padding: var(--cog-space-150);
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
  private readonly _transloco = inject(TranslocoService);

  // Resolve only the i18n *key* here; the template translates it with the
  // `*transloco` `t` function so the title re-localises live alongside the body
  // when the language changes in the dialog.
  readonly titleKey = computed(() => {
    if (this.vaultService.isNewKeyPair()) {
      return 'dialogs.vaultPassword.titleNew';
    }

    return this.vaultService.wasLocked()
      ? 'dialogs.vaultPassword.titleLocked'
      : 'dialogs.vaultPassword.titleUnlock';
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
    },
    {
      validators: (control) =>
        validateUnlockForm(control, this.vaultService.isNewKeyPair()),
    },
  );

  // Download the Account Key as a plain-text Emergency Kit the user can store
  // in a password manager or print. Generated entirely client-side.
  downloadEmergencyKit(): void {
    const accountKey = this.generatedAccountKey();
    if (!accountKey || typeof document === 'undefined') {
      return;
    }

    const blob = new Blob([buildEmergencyKitText(accountKey)], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'cognos-emergency-kit.txt';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);

    this.toastService.notify({
      title: this._transloco.translate('dialogs.vaultPassword.kitDownloadedTitle'),
      msg: this._transloco.translate('dialogs.vaultPassword.kitDownloadedMsg'),
      tone: 'success',
      icon: 'download',
      duration: 3200,
    });
  }

  async copyAccountKey(): Promise<void> {
    const accountKey = this.generatedAccountKey();
    if (!accountKey) {
      return;
    }

    const copied = await this.copyText(accountKey);
    if (!copied) {
      this.toastService.notify({
        title: this._transloco.translate('dialogs.vaultPassword.copyFailedTitle'),
        msg: this._transloco.translate('dialogs.vaultPassword.copyFailedMsg'),
        tone: 'danger',
        icon: 'shield-x',
        duration: 4200,
      });
      return;
    }

    this.toastService.notify({
      title: this._transloco.translate('dialogs.vaultPassword.copiedTitle'),
      msg: this._transloco.translate('dialogs.vaultPassword.copiedMsg'),
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

    const { accountKey } = this.vaultForm.getRawValue();

    this.vaultService.clearUnlockError();
    this.vaultService.unlockRequest$.next({
      accountKey: accountKey ?? '',
      trustDevice: true,
    });
  }
}
