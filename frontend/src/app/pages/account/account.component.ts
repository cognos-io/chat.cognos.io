import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosAvatarComponent,
  CognosAvatarPickerComponent,
  CognosButtonComponent,
  CognosCardComponent,
  CognosFieldComponent,
  CognosTextFieldComponent,
  CognosToastService,
  CognosToggleComponent,
} from '@cognos/ui-angular';

import { DataProcessingComponent } from '@app/components/account/data-processing/data-processing.component';
import { LanguageSwitcherComponent } from '@app/components/language-switcher/language-switcher.component';
import { SettingsPageComponent } from '@app/components/settings/settings-page.component';
import {
  AvatarColor,
  AvatarIcon,
  avatarIcons,
  coerceAvatarColor,
  coerceAvatarIcon,
} from '@app/interfaces/avatar';
import { MfaSettingsComponent } from '@app/pages/account/mfa-settings.component';
import { AuthService } from '@app/services/auth.service';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ConversationService } from '@app/services/conversation.service';
import { ExportService } from '@app/services/export.service';
import { UserPreferencesService } from '@app/services/user-preferences.service';
import { deriveProfileName } from '@app/utils/profile-identity';

// AccountComponent is the Account home (/account). It owns the user-facing
// profile (display name + avatar), the email- and password-change cards, and a
// danger zone. Under account_key_v2 the email and password are
// authentication-only metadata (never inputs to the data key), so changing
// either is crypto-safe; email changes go through PocketBase's verified
// request → confirm flow.
@Component({
  selector: 'app-account',
  standalone: true,
  imports: [
    CognosAvatarComponent,
    CognosAvatarPickerComponent,
    CognosCardComponent,
    CognosFieldComponent,
    CognosTextFieldComponent,
    CognosButtonComponent,
    CognosToggleComponent,
    DataProcessingComponent,
    LanguageSwitcherComponent,
    MfaSettingsComponent,
    SettingsPageComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <app-settings-page [heading]="t('account.title')">
        <cog-card
          [heading]="t('account.language.title')"
          [subtitle]="t('account.language.subtitle')"
        >
          <app-language-switcher card-actions></app-language-switcher>
        </cog-card>

        <cog-card
          [heading]="t('account.profile.title')"
          [subtitle]="t('account.profile.subtitle')"
        >
          <div class="account__fields">
            <cog-field [label]="t('account.profile.displayName')">
              <cog-text-field
                [ariaLabel]="t('account.profile.displayName')"
                [placeholder]="t('account.profile.displayNamePlaceholder')"
                [value]="displayName()"
                (valueChange)="displayName.set($event)"
              />
            </cog-field>

            <fieldset class="account__field account__fieldset">
              <legend class="account__label">{{ t('account.profile.avatar') }}</legend>
              <div class="account__avatar">
                <cog-avatar
                  class="account__avatar-preview"
                  [name]="avatarName()"
                  [icon]="avatarIcon() ?? null"
                  [color]="avatarIcon() ? avatarColor() : ''"
                  [size]="40"
                />

                <cog-avatar-picker
                  class="account__avatar-pickers"
                  [icons]="icons"
                  [selectedIcon]="avatarIcon() ?? null"
                  [selectedColor]="avatarColor()"
                  [name]="avatarName()"
                  [iconAriaLabel]="t('account.profile.iconAria')"
                  [colorAriaLabel]="t('account.profile.colorAria')"
                  (iconChange)="selectIcon($event)"
                  (colorChange)="selectColor($event)"
                />
              </div>
            </fieldset>
          </div>

          <cog-button
            card-actions
            appearance="primary"
            [disabled]="saving() || !dirty()"
            (click)="save()"
          >
            {{ saving() ? t('account.profile.saving') : t('account.profile.save') }}
          </cog-button>
        </cog-card>

        <app-data-processing />

        <cog-card
          [heading]="t('account.redaction.title')"
          [subtitle]="t('account.redaction.subtitle')"
        >
          <div card-heading-actions class="account__redaction-control">
            <span class="account__redaction-state">
              {{
                redactionEnabled()
                  ? t('account.redaction.on')
                  : t('account.redaction.off')
              }}
            </span>
            <cog-toggle
              [checked]="redactionEnabled()"
              [label]="t('account.redaction.toggleLabel')"
              (checkedChange)="setRedactionEnabled($event)"
            />
          </div>
          @if (!redactionEnabled()) {
            <p class="account__redaction-warning" role="status">
              {{ t('account.redaction.disabledNote') }}
            </p>
          }
        </cog-card>

        <cog-card
          [heading]="t('account.email.title')"
          [subtitle]="t('account.email.subtitle')"
        >
          <div class="account__fields">
            <cog-field [label]="t('account.email.current')">
              <cog-text-field
                [ariaLabel]="t('account.email.current')"
                [value]="email()"
                [readonly]="true"
                [disabled]="true"
              />
            </cog-field>
            <cog-field [label]="t('account.email.new')">
              <cog-text-field
                [ariaLabel]="t('account.email.new')"
                type="email"
                [placeholder]="t('common.emailPlaceholder')"
                [value]="newEmail()"
                (valueChange)="newEmail.set($event)"
              />
            </cog-field>
          </div>

          @if (emailChangeError()) {
            <p class="account__error">{{ emailChangeError() }}</p>
          }

          <cog-button
            card-actions
            appearance="primary"
            [disabled]="!canRequestEmailChange()"
            (click)="requestEmailChange()"
          >
            {{
              requestingEmailChange()
                ? t('account.email.sending')
                : t('account.email.send')
            }}
          </cog-button>
        </cog-card>

        <cog-card
          [heading]="t('account.password.title')"
          [subtitle]="t('account.password.subtitle')"
        >
          <div class="account__fields">
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
            <p class="account__error">{{ passwordError() }}</p>
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

        <!-- Two-factor authentication (rendered as account-style cards). -->
        <app-mfa-settings />

        <cog-card
          [heading]="t('account.data.title')"
          [subtitle]="t('account.data.subtitle')"
        >
          <cog-button
            card-actions
            appearance="default"
            icon="download"
            [disabled]="exporting()"
            (click)="exportData()"
          >
            {{ exporting() ? t('account.data.preparing') : t('account.data.download') }}
          </cog-button>
        </cog-card>

        <cog-card [heading]="t('account.danger.title')" tone="danger">
          <div class="account__danger-row">
            <div class="account__danger-copy">
              <p class="account__danger-title">
                {{ t('account.danger.deleteChatsTitle') }}
              </p>
              <p class="account__danger-desc">
                {{ t('account.danger.deleteChatsSubtitle') }}
              </p>
            </div>

            @if (confirmingDeleteChats()) {
              <div class="account__danger-confirm">
                <cog-button
                  appearance="danger"
                  [disabled]="deletingChats()"
                  (click)="deleteAllChats()"
                >
                  {{
                    deletingChats()
                      ? t('account.danger.deleting')
                      : t('account.danger.deleteChatsConfirm')
                  }}
                </cog-button>
                <cog-button
                  appearance="subtle"
                  [disabled]="deletingChats()"
                  (click)="confirmingDeleteChats.set(false)"
                >
                  {{ t('common.cancel') }}
                </cog-button>
              </div>
            } @else {
              <cog-button appearance="danger" (click)="confirmingDeleteChats.set(true)">
                {{ t('account.danger.deleteChatsTitle') }}
              </cog-button>
            }
          </div>

          <hr class="account__danger-divider" />

          <div class="account__danger-row">
            <div class="account__danger-copy">
              <p class="account__danger-title">
                {{ t('account.danger.deleteAccountTitle') }}
              </p>
              <p class="account__danger-desc">
                {{ t('account.danger.deleteAccountSubtitle') }}
              </p>

              @if (confirmingDeleteAccount()) {
                <div class="account__field account__danger-confirm-field">
                  <span
                    class="account__hint"
                    [innerHTML]="
                      t('account.danger.typeToConfirm', {
                        word: '<strong>DELETE</strong>',
                      })
                    "
                  ></span>
                  <cog-text-field
                    [ariaLabel]="t('account.danger.confirmFieldAria')"
                    placeholder="DELETE"
                    [value]="deleteAccountConfirmText()"
                    (valueChange)="deleteAccountConfirmText.set($event)"
                  />
                </div>
              }
            </div>

            @if (confirmingDeleteAccount()) {
              <div class="account__danger-confirm">
                <cog-button
                  appearance="danger"
                  [disabled]="deletingAccount() || !canDeleteAccount()"
                  (click)="deleteAccount()"
                >
                  {{
                    deletingAccount()
                      ? t('account.danger.deleting')
                      : t('account.danger.deleteAccountConfirm')
                  }}
                </cog-button>
                <cog-button
                  appearance="subtle"
                  [disabled]="deletingAccount()"
                  (click)="cancelDeleteAccount()"
                >
                  {{ t('common.cancel') }}
                </cog-button>
              </div>
            } @else {
              <cog-button
                appearance="danger"
                (click)="confirmingDeleteAccount.set(true)"
              >
                {{ t('account.danger.deleteAccountTitle') }}
              </cog-button>
            }
          </div>
        </cog-card>
      </app-settings-page>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
    }

    .account__redaction-control {
      display: flex;
      flex-shrink: 0;
      align-items: center;
      gap: var(--cog-space-150);
    }

    .account__redaction-state {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
    }

    .account__redaction-warning {
      margin: var(--cog-space-150) 0 0;
      color: var(--cog-danger-text);
      font-size: var(--cog-fs-body-sm);
      line-height: var(--cog-lh-body-sm);
    }

    .account__fields {
      display: grid;
      gap: var(--cog-space-200);
      margin-top: var(--cog-space-100);
      min-width: 0;
    }

    .account__avatar {
      display: flex;
      gap: var(--cog-space-150);
      align-items: center;
      margin-top: var(--cog-space-050);
    }

    .account__avatar-preview {
      flex: none;
    }

    .account__avatar-pickers {
      display: grid;
      gap: var(--cog-space-100);
      flex: 1;
      min-width: 0;
      max-width: 460px;
    }

    .account__field {
      display: grid;
      gap: var(--cog-space-050);
    }

    .account__label {
      color: var(--cog-text);
      font-size: var(--cog-fs-body-sm);
      font-weight: var(--cog-fw-semibold);
    }

    .account__hint {
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
    }

    .account__error {
      margin: 0;
      color: var(--cog-danger-text);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .account__fieldset {
      margin: 0;
      padding: 0;
      border: 0;
    }

    .account__actions {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--cog-space-100);
    }

    .account__danger-desc {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }

    .account__danger-row {
      display: flex;
      gap: var(--cog-space-150);
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      margin-top: var(--cog-space-100);
    }

    .account__danger-copy {
      flex: 1;
      min-width: 0;
    }

    .account__danger-title {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      font-weight: var(--cog-fw-semibold);
    }

    .account__danger-confirm {
      display: flex;
      gap: var(--cog-space-100);
      align-items: center;
    }

    .account__danger-confirm-field {
      margin-top: var(--cog-space-100);
      max-width: 280px;
    }

    .account__danger-divider {
      width: 100%;
      height: 1px;
      border: 0;
      margin: var(--cog-space-150) 0 0;
      background: var(--cog-danger-border);
    }
  `,
})
export class AccountComponent {
  private readonly _auth = inject(AuthService);
  private readonly _api = inject(CognosApiService);
  private readonly _conversations = inject(ConversationService);
  private readonly _export = inject(ExportService);
  private readonly _router = inject(Router);
  private readonly _toast = inject(CognosToastService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _userPreferences = inject(UserPreferencesService);

  protected readonly redactionEnabled = this._userPreferences.redactionEnabled;

  protected setRedactionEnabled(enabled: boolean): void {
    this._userPreferences.setRedactionEnabled(enabled);
  }

  protected readonly email = this._auth.email;
  protected readonly icons = avatarIcons;

  // The persisted profile values, read live from the auth record.
  private readonly _persistedDisplayName = computed(
    () => (this._auth.user()?.['display_name'] as string | undefined)?.trim() ?? '',
  );
  private readonly _persistedIcon = computed(() =>
    coerceAvatarIcon(this._auth.user()?.['avatar_icon']),
  );
  private readonly _persistedColor = computed(() =>
    coerceAvatarColor(this._auth.user()?.['avatar_color']),
  );

  // The editable drafts, seeded from the persisted values.
  protected readonly displayName = signal(this._persistedDisplayName());
  protected readonly avatarIcon = signal<AvatarIcon | undefined>(this._persistedIcon());
  protected readonly avatarColor = signal<AvatarColor>(this._persistedColor());

  protected readonly saving = signal(false);

  protected readonly currentPassword = signal('');
  protected readonly newPassword = signal('');
  protected readonly changingPassword = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly canChangePassword = computed(
    () =>
      !this.changingPassword() &&
      this.currentPassword().length > 0 &&
      this.newPassword().length >= 12,
  );

  protected readonly newEmail = signal('');
  protected readonly requestingEmailChange = signal(false);
  protected readonly emailChangeError = signal<string | null>(null);
  protected readonly canRequestEmailChange = computed(() => {
    const next = this.newEmail().trim();
    return (
      !this.requestingEmailChange() &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next) &&
      next.toLowerCase() !== this.email().trim().toLowerCase()
    );
  });

  protected readonly confirmingDeleteChats = signal(false);
  protected readonly deletingChats = signal(false);

  protected readonly exporting = signal(false);

  protected readonly confirmingDeleteAccount = signal(false);
  protected readonly deletingAccount = signal(false);
  protected readonly deleteAccountConfirmText = signal('');
  protected readonly canDeleteAccount = computed(
    () => this.deleteAccountConfirmText().trim().toUpperCase() === 'DELETE',
  );

  protected readonly dirty = computed(
    () =>
      this.displayName().trim() !== this._persistedDisplayName() ||
      this.avatarIcon() !== this._persistedIcon() ||
      this.avatarColor() !== this._persistedColor(),
  );

  protected readonly avatarName = computed(() =>
    deriveProfileName(this.displayName(), this.email()),
  );

  selectIcon(icon: string): void {
    const coerced = coerceAvatarIcon(icon);
    if (!coerced) {
      return;
    }
    // Re-selecting the active icon clears it, falling back to initials.
    this.avatarIcon.update((current) => (current === coerced ? undefined : coerced));
  }

  selectColor(color: AvatarColor): void {
    this.avatarColor.set(color);
  }

  save(): void {
    if (this.saving() || !this.dirty()) {
      return;
    }

    this.saving.set(true);
    this._auth
      .updateProfile({
        display_name: this.displayName().trim(),
        avatar_icon: this.avatarIcon() ?? '',
        avatar_color: this.avatarColor(),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this._toast.notify({
            title: this._transloco.translate('account.toasts.profileUpdated'),
          });
        },
        error: () => this.saving.set(false),
      });
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

  requestEmailChange(): void {
    if (!this.canRequestEmailChange()) {
      return;
    }

    const target = this.newEmail().trim();
    this.requestingEmailChange.set(true);
    this.emailChangeError.set(null);
    this._auth.requestEmailChange(target).subscribe({
      next: () => {
        this.requestingEmailChange.set(false);
        this.newEmail.set('');
        this._toast.notify({
          title: this._transloco.translate('account.toasts.emailLinkSentTitle'),
          msg: this._transloco.translate('account.toasts.emailLinkSentMsg', {
            email: target,
          }),
        });
      },
      error: () => {
        this.requestingEmailChange.set(false);
        this.emailChangeError.set(
          this._transloco.translate('account.errors.emailChange'),
        );
      },
    });
  }

  deleteAllChats(): void {
    if (this.deletingChats()) {
      return;
    }

    this.deletingChats.set(true);
    this._conversations.deleteAllConversations().subscribe({
      next: ({ deleted }) => {
        this.deletingChats.set(false);
        this.confirmingDeleteChats.set(false);
        this._toast.notify({
          title:
            deleted === 1
              ? this._transloco.translate('account.toasts.deletedOneChat')
              : this._transloco.translate('account.toasts.deletedManyChats', {
                  count: deleted,
                }),
        });
      },
      error: () => {
        this.deletingChats.set(false);
        this._toast.notify({
          title: this._transloco.translate('account.toasts.deleteChatsError'),
          tone: 'danger',
        });
      },
    });
  }

  exportData(): void {
    if (this.exporting()) {
      return;
    }

    this.exporting.set(true);
    this._export
      .downloadExport(new Date())
      .then(({ conversation_count }) => {
        this._toast.notify({
          title:
            conversation_count === 1
              ? this._transloco.translate('account.toasts.exportedOne')
              : this._transloco.translate('account.toasts.exportedMany', {
                  count: conversation_count,
                }),
        });
      })
      .catch(() => {
        this._toast.notify({
          title: this._transloco.translate('account.toasts.exportError'),
          tone: 'danger',
        });
      })
      .finally(() => this.exporting.set(false));
  }

  cancelDeleteAccount(): void {
    this.confirmingDeleteAccount.set(false);
    this.deleteAccountConfirmText.set('');
  }

  deleteAccount(): void {
    if (this.deletingAccount() || !this.canDeleteAccount()) {
      return;
    }

    this.deletingAccount.set(true);
    this._api.deleteAccount().subscribe({
      next: async () => {
        // The account is gone — clear the session and send them to login.
        await this._auth.logout();
        this._toast.notify({
          title: this._transloco.translate('account.toasts.accountDeleted'),
        });
        await this._router.navigate(['/', 'auth', 'login']);
      },
      error: (error: unknown) => {
        this.deletingAccount.set(false);
        const conflict = (error as { status?: number })?.status === 409;
        this._toast.notify({
          title: conflict
            ? this._transloco.translate('account.toasts.deleteAccountConflict')
            : this._transloco.translate('account.toasts.deleteAccountError'),
          tone: 'danger',
        });
      },
    });
  }
}
