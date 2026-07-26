import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosCalloutComponent,
  CognosCardComponent,
  CognosFieldComponent,
  CognosTextFieldComponent,
  CognosToastService,
} from '@cognos/ui-angular';

import { GoogleIconComponent } from '@app/components/google-icon/google-icon.component';
import { SettingsPageComponent } from '@app/components/settings/settings-page.component';
import {
  buildEmergencyKitText,
  emergencyKitStringsFrom,
} from '@app/components/vault-password-dialog/vault-password-dialog.component';
import { MfaSettingsComponent } from '@app/pages/account/mfa-settings.component';
import { AuthService } from '@app/services/auth.service';
import { VaultService } from '@app/services/vault.service';

// AccountSecurityComponent is the home for Security & keys (/account/security):
// re-download the Emergency Kit / copy the Account Key while unlocked, change the
// account password, and manage two-factor authentication (the password card and
// MFA cards were relocated here from the Account home).
//
// Note on the Account Key: for security the Account Key is never kept in memory
// after the vault is unlocked (it derives an Argon2id unlock key and is then
// discarded), so it can only be re-downloaded/copied while it is still held —
// i.e. right after sign-up, before the user acknowledges saving it. For a
// returning, already-unlocked user we can't reproduce it, so we point them at
// the Emergency Kit they saved at sign-up rather than pretend otherwise.
@Component({
  selector: 'app-account-security',
  standalone: true,
  imports: [
    CognosButtonComponent,
    CognosCalloutComponent,
    CognosCardComponent,
    CognosFieldComponent,
    CognosTextFieldComponent,
    GoogleIconComponent,
    MfaSettingsComponent,
    SettingsPageComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <app-settings-page
        [heading]="t('settings.nav.security')"
        [subtitle]="t('settings.security.pageLead')"
      >
        <cog-card
          [heading]="t('settings.security.kit.title')"
          [subtitle]="t('settings.security.kit.description')"
        >
          @if (!vault.isUnlocked()) {
            <cog-callout tone="warning" icon="lock">
              <strong>{{ t('settings.security.kit.lockedTitle') }}</strong
              ><br />
              {{ t('settings.security.kit.lockedBody') }}
            </cog-callout>
          } @else if (accountKey()) {
            <div class="account-security__kit-actions">
              <cog-button
                appearance="primary"
                icon="download"
                (click)="downloadEmergencyKit()"
              >
                {{ t('settings.security.kit.download') }}
              </cog-button>
              <cog-button appearance="default" icon="copy" (click)="copyAccountKey()">
                {{ t('settings.security.kit.copy') }}
              </cog-button>
            </div>
          } @else {
            <cog-callout tone="info" icon="info">
              <strong>{{ t('settings.security.kit.unavailableTitle') }}</strong
              ><br />
              {{ t('settings.security.kit.unavailableBody') }}
            </cog-callout>
          }
        </cog-card>

        @if (hasPassword()) {
          <cog-card
            [heading]="t('settings.security.passwordHeading')"
            [subtitle]="t('account.password.subtitle')"
          >
            <div class="account-security__fields">
              <cog-field [label]="t('account.password.current')">
                <cog-text-field
                  [ariaLabel]="t('account.password.current')"
                  type="password"
                  [value]="currentPassword()"
                  (valueChange)="currentPassword.set($event)"
                />
              </cog-field>
              <cog-field [label]="t('account.password.new')">
                <cog-text-field
                  [ariaLabel]="t('account.password.new')"
                  type="password"
                  [placeholder]="t('account.password.newPlaceholder')"
                  [value]="newPassword()"
                  (valueChange)="newPassword.set($event)"
                />
              </cog-field>
            </div>

            @if (passwordError()) {
              <p class="account-security__error">{{ passwordError() }}</p>
            }

            <cog-button
              card-actions
              appearance="primary"
              [disabled]="!canChangePassword()"
              (click)="changePassword()"
            >
              {{
                changingPassword()
                  ? t('account.password.changing')
                  : t('account.password.change')
              }}
            </cog-button>
          </cog-card>
        }

        <cog-card
          [heading]="t('settings.security.connectedAccounts.heading')"
          [subtitle]="t('settings.security.connectedAccounts.description')"
        >
          @if (isGoogleLinked()) {
            <cog-callout tone="success" icon="check">
              <app-google-icon [size]="16" />
              {{ t('settings.security.connectedAccounts.googleConnected') }}
            </cog-callout>
          } @else if (hasPassword()) {
            <div class="account-security__fields">
              <cog-field [label]="t('account.password.current')">
                <cog-text-field
                  [ariaLabel]="t('account.password.current')"
                  type="password"
                  autocomplete="current-password"
                  [value]="linkPassword()"
                  (valueChange)="linkPassword.set($event)"
                />
              </cog-field>
            </div>

            @if (linkError()) {
              <p class="account-security__error">{{ linkError() }}</p>
            }
          } @else {
            <!-- Unreachable in practice: an OAuth-only account already has
                 Google linked. Kept as a safe fallback. -->
            <cog-callout tone="info" icon="info">
              {{ t('settings.security.connectedAccounts.signedInWithGoogle') }}
            </cog-callout>
          }

          @if (!isGoogleLinked() && hasPassword()) {
            <cog-button
              card-actions
              appearance="default"
              [disabled]="!canConnectGoogle()"
              (click)="connectGoogle()"
            >
              @if (googleBusy()) {
                {{ t('settings.security.connectedAccounts.connecting') }}
              } @else {
                <app-google-icon />
                {{ t('settings.security.connectedAccounts.connectGoogle') }}
              }
            </cog-button>
          }
        </cog-card>

        @if (!hasPassword()) {
          <cog-callout tone="info" icon="info">
            <strong>{{
              t('settings.security.connectedAccounts.oauthOnlyTitle')
            }}</strong
            ><br />
            {{ t('settings.security.connectedAccounts.oauthOnlyBody') }}
          </cog-callout>
        }

        <cog-card
          [heading]="t('settings.security.sessions.heading')"
          [subtitle]="t('settings.security.sessions.description')"
        >
          <cog-button
            card-actions
            appearance="default"
            icon="monitor-smartphone"
            [disabled]="revokingOtherSessions()"
            (click)="signOutOtherDevices()"
          >
            {{
              revokingOtherSessions()
                ? t('settings.security.sessions.signingOut')
                : t('settings.security.sessions.button')
            }}
          </cog-button>
        </cog-card>

        <!-- Two-factor authentication (relocated from the Account home).
             Password-gated (MFA enrol/disable confirm with a password), so
             hidden for OAuth-only Accounts. -->
        @if (hasPassword()) {
          <app-mfa-settings />
        }
      </app-settings-page>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
    }

    .account-security__kit-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--cog-space-100);
      margin-top: var(--cog-space-100);
    }

    .account-security__fields {
      display: grid;
      gap: var(--cog-space-200);
      margin-top: var(--cog-space-100);
      min-width: 0;
    }

    .account-security__error {
      margin: 0;
      color: var(--cog-danger-text);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }
  `,
})
export class AccountSecurityComponent {
  readonly vault = inject(VaultService);
  private readonly _auth = inject(AuthService);
  private readonly _toast = inject(CognosToastService);
  private readonly _transloco = inject(TranslocoService);

  // Only populated in the brief window before a new account acknowledges saving
  // its key (see the class comment); null for a returning unlocked user.
  protected readonly accountKey = computed(() => this.vault.generatedAccountKey());

  protected readonly currentPassword = signal('');
  protected readonly newPassword = signal('');
  protected readonly changingPassword = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly revokingOtherSessions = signal(false);
  protected readonly canChangePassword = computed(
    () =>
      !this.changingPassword() &&
      this.currentPassword().length > 0 &&
      this.newPassword().length >= 12,
  );

  // Google account linking (docs/business_processes/oauth-account-link.md).
  protected readonly hasPassword = this._auth.hasPassword;
  protected readonly isGoogleLinked = this._auth.isGoogleLinked;
  protected readonly googleBusy = this._auth.googleBusy;
  protected readonly linkPassword = signal('');
  protected readonly linkError = signal<string | null>(null);
  protected readonly canConnectGoogle = computed(
    () => !this.googleBusy() && this.linkPassword().length > 0,
  );

  constructor() {
    this._auth.loadAuthMethods().subscribe();
  }

  downloadEmergencyKit(): void {
    const accountKey = this.accountKey();
    if (!accountKey || typeof document === 'undefined') {
      return;
    }

    const blob = new Blob(
      [
        buildEmergencyKitText(
          accountKey,
          emergencyKitStringsFrom(this._transloco, this.vault.accountEmail()),
        ),
      ],
      { type: 'text/plain;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'cognos-emergency-kit.txt';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);

    this._toast.notify({
      title: this._transloco.translate('settings.security.kit.downloadedToast'),
      tone: 'success',
      icon: 'download',
    });
  }

  async copyAccountKey(): Promise<void> {
    const accountKey = this.accountKey();
    if (!accountKey || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(accountKey);
      this._toast.notify({
        title: this._transloco.translate('settings.security.kit.copiedToast'),
        tone: 'success',
        icon: 'copy',
      });
    } catch {
      /* clipboard unavailable — the download path remains */
    }
  }

  changePassword(): void {
    if (!this.canChangePassword()) {
      return;
    }

    this.changingPassword.set(true);
    this.passwordError.set(null);
    this._auth.changePassword(this.currentPassword(), this.newPassword()).subscribe({
      next: () => {
        this.changingPassword.set(false);
        this.currentPassword.set('');
        this.newPassword.set('');
        this._toast.notify({
          title: this._transloco.translate('account.toasts.passwordChanged'),
        });
      },
      error: () => {
        this.changingPassword.set(false);
        this.passwordError.set(
          this._transloco.translate('account.errors.passwordChange'),
        );
      },
    });
  }

  // Must stay a plain (non-async) method invoked directly from (click) —
  // PocketBase opens the OAuth popup synchronously, and Safari blocks popups
  // opened outside that gesture. The password confirmation happens over the
  // network first, so a popup is pre-opened here and handed to linkGoogle,
  // which navigates it once the Google URL is known.
  connectGoogle(): void {
    if (!this.canConnectGoogle()) {
      return;
    }

    this.linkError.set(null);
    const popup =
      typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null;

    this._auth.linkGoogle(this.linkPassword(), popup).subscribe({
      next: () => {
        this.linkPassword.set('');
        this._toast.notify({
          title: this._transloco.translate(
            'settings.security.connectedAccounts.connectedToast',
          ),
          tone: 'success',
          icon: 'check',
        });
      },
      error: () => {
        this.linkError.set(
          this._auth.oauthError() === 'accountExists'
            ? this._transloco.translate('auth.google.accountExists')
            : this._transloco.translate('account.errors.googleLink'),
        );
      },
    });
  }

  signOutOtherDevices(): void {
    if (this.revokingOtherSessions()) {
      return;
    }

    this.revokingOtherSessions.set(true);
    this._auth.revokeOtherSessions().subscribe({
      next: () => {
        this.revokingOtherSessions.set(false);
        this._toast.notify({
          title: this._transloco.translate('settings.security.sessions.successToast'),
          tone: 'success',
          icon: 'check',
        });
      },
      error: () => {
        this.revokingOtherSessions.set(false);
        this._toast.notify({
          title: this._transloco.translate('settings.security.sessions.errorToast'),
          tone: 'danger',
        });
      },
    });
  }
}
