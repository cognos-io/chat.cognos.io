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
  CognosButtonComponent,
  CognosIconComponent,
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
  avatarColors,
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
    CognosIconComponent,
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
        <section class="account__card" aria-labelledby="account-language-heading">
          <h2 id="account-language-heading" class="account__card-title">
            {{ t('account.language.title') }}
          </h2>
          <p class="account__card-subtitle">{{ t('account.language.subtitle') }}</p>
          <div class="account__actions">
            <app-language-switcher></app-language-switcher>
          </div>
        </section>

        <section class="account__card" aria-labelledby="account-profile-heading">
          <h2 id="account-profile-heading" class="account__card-title">
            {{ t('account.profile.title') }}
          </h2>
          <p class="account__card-subtitle">{{ t('account.profile.subtitle') }}</p>

          <div class="account__fields">
            <div class="account__field">
              <span class="account__label">{{ t('account.profile.displayName') }}</span>
              <cog-text-field
                [ariaLabel]="t('account.profile.displayName')"
                [placeholder]="t('account.profile.displayNamePlaceholder')"
                [value]="displayName()"
                (valueChange)="displayName.set($event)"
              />
            </div>

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

                <div class="account__avatar-pickers">
                  <div
                    class="account__icon-grid"
                    role="radiogroup"
                    [attr.aria-label]="t('account.profile.iconAria')"
                  >
                    @for (option of icons; track option) {
                      <button
                        type="button"
                        class="account__icon-button"
                        [class.is-selected]="avatarIcon() === option"
                        [attr.aria-label]="
                          t('account.profile.iconOptionAria', { name: option })
                        "
                        [attr.aria-pressed]="avatarIcon() === option"
                        (click)="selectIcon(option)"
                      >
                        <cog-icon [name]="option" [size]="18" tone="current" />
                      </button>
                    }
                  </div>

                  <div
                    class="account__color-row"
                    role="radiogroup"
                    [attr.aria-label]="t('account.profile.colorAria')"
                  >
                    @for (option of colors; track option) {
                      <button
                        type="button"
                        class="account__color-swatch"
                        [class]="'account__color-swatch--' + option"
                        [class.is-selected]="avatarColor() === option"
                        [attr.aria-label]="
                          t('account.profile.colorOptionAria', { name: option })
                        "
                        [attr.aria-pressed]="avatarColor() === option"
                        (click)="selectColor(option)"
                      ></button>
                    }
                  </div>
                </div>
              </div>
            </fieldset>
          </div>

          <div class="account__actions">
            <cog-button
              appearance="primary"
              [disabled]="saving() || !dirty()"
              (click)="save()"
            >
              {{ saving() ? t('account.profile.saving') : t('account.profile.save') }}
            </cog-button>
          </div>
        </section>

        <app-data-processing />

        <section class="account__card" aria-labelledby="account-redaction-heading">
          <div class="account__redaction-header">
            <div class="account__redaction-text">
              <h2 id="account-redaction-heading" class="account__card-title">
                {{ t('account.redaction.title') }}
              </h2>
              <p class="account__card-subtitle">
                {{ t('account.redaction.subtitle') }}
              </p>
            </div>
            <div class="account__redaction-control">
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
          </div>
          @if (!redactionEnabled()) {
            <p class="account__redaction-warning" role="status">
              {{ t('account.redaction.disabledNote') }}
            </p>
          }
        </section>

        <section class="account__card" aria-labelledby="account-email-heading">
          <h2 id="account-email-heading" class="account__card-title">
            {{ t('account.email.title') }}
          </h2>
          <p class="account__card-subtitle">{{ t('account.email.subtitle') }}</p>

          <div class="account__fields">
            <div class="account__field">
              <span class="account__label">{{ t('account.email.current') }}</span>
              <cog-text-field
                [ariaLabel]="t('account.email.current')"
                [value]="email()"
                [readonly]="true"
                [disabled]="true"
              />
            </div>
            <div class="account__field">
              <span class="account__label">{{ t('account.email.new') }}</span>
              <cog-text-field
                [ariaLabel]="t('account.email.new')"
                type="email"
                [placeholder]="t('common.emailPlaceholder')"
                [value]="newEmail()"
                (valueChange)="newEmail.set($event)"
              />
            </div>
          </div>

          @if (emailChangeError()) {
            <p class="account__error">{{ emailChangeError() }}</p>
          }

          <div class="account__actions">
            <cog-button
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
          </div>
        </section>

        <section class="account__card" aria-labelledby="account-password-heading">
          <h2 id="account-password-heading" class="account__card-title">
            {{ t('account.password.title') }}
          </h2>
          <p class="account__card-subtitle">{{ t('account.password.subtitle') }}</p>

          <div class="account__fields">
            <div class="account__field">
              <span class="account__label">{{ t('account.password.current') }}</span>
              <cog-text-field
                [ariaLabel]="t('account.password.current')"
                type="password"
                [value]="currentPassword()"
                (valueChange)="currentPassword.set($event)"
              />
            </div>
            <div class="account__field">
              <span class="account__label">{{ t('account.password.new') }}</span>
              <cog-text-field
                [ariaLabel]="t('account.password.new')"
                type="password"
                [placeholder]="t('account.password.newPlaceholder')"
                [value]="newPassword()"
                (valueChange)="newPassword.set($event)"
              />
            </div>
          </div>

          @if (passwordError()) {
            <p class="account__error">{{ passwordError() }}</p>
          }

          <div class="account__actions">
            <cog-button
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
          </div>
        </section>

        <!-- Two-factor authentication (rendered as account-style cards). -->
        <app-mfa-settings />

        <section class="account__card" aria-labelledby="account-data-heading">
          <h2 id="account-data-heading" class="account__card-title">
            {{ t('account.data.title') }}
          </h2>
          <p class="account__card-subtitle">{{ t('account.data.subtitle') }}</p>
          <div class="account__actions">
            <cog-button
              appearance="default"
              icon="download"
              [disabled]="exporting()"
              (click)="exportData()"
            >
              {{
                exporting() ? t('account.data.preparing') : t('account.data.download')
              }}
            </cog-button>
          </div>
        </section>

        <section
          class="account__card account__danger"
          aria-labelledby="account-danger-heading"
        >
          <h2 id="account-danger-heading" class="account__card-title">
            {{ t('account.danger.title') }}
          </h2>

          <div class="account__danger-row">
            <div class="account__danger-copy">
              <p class="account__danger-title">
                {{ t('account.danger.deleteChatsTitle') }}
              </p>
              <p class="account__card-subtitle">
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
              <p class="account__card-subtitle">
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
        </section>
      </app-settings-page>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
    }

    .account__card {
      display: grid;
      gap: var(--cog-space-100);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      padding: var(--cog-space-250, 20px);
    }

    .account__card-title {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-h-sm);
      font-weight: var(--cog-fw-semibold);
    }

    .account__card-subtitle {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
    }

    .account__redaction-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--cog-space-200);
    }

    .account__redaction-text {
      display: grid;
      gap: var(--cog-space-100);
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
      color: var(--cog-text-danger, var(--cog-danger, #b42318));
      font-size: var(--cog-fs-body-sm);
      line-height: var(--cog-lh-body-sm);
    }

    .account__fields {
      display: grid;
      gap: var(--cog-space-200, 16px);
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
      color: var(--cog-danger-text, #b91c1c);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .account__fieldset {
      margin: 0;
      padding: 0;
      border: 0;
    }

    .account__icon-grid {
      display: grid;
      grid-template-columns: repeat(10, 1fr);
      gap: var(--cog-space-075);
    }

    .account__icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      aspect-ratio: 1;
      border: 2px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface);
      color: var(--cog-text-subtle);
      cursor: pointer;
      transition:
        border-color var(--cog-dur-fast) var(--cog-ease-standard),
        color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .account__icon-button:hover {
      color: var(--cog-text);
    }

    .account__icon-button.is-selected {
      border-color: var(--cog-brand);
      color: var(--cog-text);
    }

    .account__color-row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--cog-space-075);
    }

    .account__color-swatch {
      inline-size: 28px;
      block-size: 28px;
      border: 2px solid transparent;
      border-radius: var(--cog-radius-pill);
      cursor: pointer;
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
    }

    .account__color-swatch.is-selected {
      border-color: var(--cog-text);
    }

    .account__color-swatch--green {
      background: #dcfce7;
    }
    .account__color-swatch--blue {
      background: #dbeafe;
    }
    .account__color-swatch--indigo {
      background: #e0e7ff;
    }
    .account__color-swatch--violet {
      background: #ede9fe;
    }
    .account__color-swatch--teal {
      background: #ccfbf1;
    }
    .account__color-swatch--sky {
      background: #e0f2fe;
    }
    .account__color-swatch--amber {
      background: #fef3c7;
    }
    .account__color-swatch--orange {
      background: #ffedd5;
    }
    .account__color-swatch--pink {
      background: #fce7f3;
    }
    .account__color-swatch--slate {
      background: #eef0f3;
    }
    /* "No fill": a surface circle with a diagonal slash (border comes from the
       swatch's inset shadow). */
    .account__color-swatch--transparent {
      background:
        linear-gradient(
          to top right,
          transparent calc(50% - 1px),
          var(--cog-text-subtlest, #94a3b8) calc(50% - 1px),
          var(--cog-text-subtlest, #94a3b8) calc(50% + 1px),
          transparent calc(50% + 1px)
        ),
        var(--cog-surface, #fff);
    }

    .account__actions {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--cog-space-100);
    }

    .account__danger {
      border-color: var(--cog-danger-border, #f1c0c0);
      background: var(--cog-danger-surface, #fef2f2);
    }

    .account__danger .account__card-title {
      color: var(--cog-danger-text, #b91c1c);
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
      font-size: var(--cog-fs-body-sm);
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
      background: var(--cog-danger-border, #f1c0c0);
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
  protected readonly colors = avatarColors;

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

  selectIcon(icon: AvatarIcon): void {
    // Re-selecting the active icon clears it, falling back to initials.
    this.avatarIcon.update((current) => (current === icon ? undefined : icon));
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
