import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';

import {
  CognosAvatarComponent,
  CognosBreadcrumbsComponent,
  CognosButtonComponent,
  CognosIconComponent,
  CognosTextFieldComponent,
  CognosToastService,
} from '@cognos/ui-angular';

import { DataProcessingComponent } from '@app/components/account/data-processing/data-processing.component';
import {
  AvatarColor,
  AvatarIcon,
  avatarColors,
  avatarIcons,
  coerceAvatarColor,
  coerceAvatarIcon,
} from '@app/interfaces/avatar';
import { AuthService } from '@app/services/auth.service';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ConversationService } from '@app/services/conversation.service';
import { ExportService } from '@app/services/export.service';
import { deriveProfileName } from '@app/utils/profile-identity';

// AccountComponent is the Account home (/account). It owns the user-facing
// profile (display name, and — added separately — avatar) plus a danger zone.
// Identity stays privacy-preserving: the email is shown read-only and never
// edited here (email changes are blocked server-side until account-key re-auth).
@Component({
  selector: 'app-account',
  standalone: true,
  imports: [
    CognosBreadcrumbsComponent,
    CognosAvatarComponent,
    CognosIconComponent,
    CognosTextFieldComponent,
    CognosButtonComponent,
    DataProcessingComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="account__header">
      <cog-breadcrumbs
        [items]="[
          { label: 'Cognos' },
          { label: 'Settings' },
          { label: 'Account', current: true },
        ]"
      />
      <h1 class="account__title">Account</h1>
    </header>

    <section class="account__card" aria-labelledby="account-profile-heading">
      <h2 id="account-profile-heading" class="account__card-title">Profile</h2>
      <p class="account__card-subtitle">
        Your display name appears on your messages and in shared chats.
      </p>

      <div class="account__fields">
        <div class="account__field">
          <span class="account__label">Display name</span>
          <cog-text-field
            ariaLabel="Display name"
            placeholder="Add a display name"
            [value]="displayName()"
            (valueChange)="displayName.set($event)"
          />
        </div>

        <div class="account__field">
          <span class="account__label">Email</span>
          <cog-text-field
            ariaLabel="Email"
            [value]="email()"
            [readonly]="true"
            [disabled]="true"
          />
          <span class="account__hint">
            Email changes aren’t available yet. Contact support if you need to change
            it.
          </span>
        </div>

        <fieldset class="account__field account__fieldset">
          <legend class="account__label">Avatar</legend>
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
                aria-label="Avatar icon"
              >
                @for (option of icons; track option) {
                  <button
                    type="button"
                    class="account__icon-button"
                    [class.is-selected]="avatarIcon() === option"
                    [attr.aria-label]="'Icon ' + option"
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
                aria-label="Avatar colour"
              >
                @for (option of colors; track option) {
                  <button
                    type="button"
                    class="account__color-swatch"
                    [class]="'account__color-swatch--' + option"
                    [class.is-selected]="avatarColor() === option"
                    [attr.aria-label]="'Colour ' + option"
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
          {{ saving() ? 'Saving…' : 'Save profile' }}
        </cog-button>
      </div>
    </section>

    <app-data-processing />

    <section class="account__card" aria-labelledby="account-data-heading">
      <h2 id="account-data-heading" class="account__card-title">Your data</h2>
      <p class="account__card-subtitle">
        Download all your conversations and messages — decrypted in your browser — as a
        JSON file.
      </p>
      <div class="account__actions">
        <cog-button
          appearance="default"
          icon="download"
          [disabled]="exporting()"
          (click)="exportData()"
        >
          {{ exporting() ? 'Preparing…' : 'Download my data' }}
        </cog-button>
      </div>
    </section>

    <section class="account__card" aria-labelledby="account-password-heading">
      <h2 id="account-password-heading" class="account__card-title">Password</h2>
      <p class="account__card-subtitle">
        Your password only signs you in — it does not unlock your data (that's your
        Account Key). Changing it is safe and never affects your encrypted chats.
      </p>

      <div class="account__fields">
        <div class="account__field">
          <span class="account__label">Current password</span>
          <cog-text-field
            ariaLabel="Current password"
            type="password"
            [value]="currentPassword()"
            (valueChange)="currentPassword.set($event)"
          />
        </div>
        <div class="account__field">
          <span class="account__label">New password</span>
          <cog-text-field
            ariaLabel="New password"
            type="password"
            placeholder="At least 12 characters"
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
          {{ changingPassword() ? 'Changing…' : 'Change password' }}
        </cog-button>
      </div>
    </section>

    <section
      class="account__card account__danger"
      aria-labelledby="account-danger-heading"
    >
      <h2 id="account-danger-heading" class="account__card-title">Danger zone</h2>

      <div class="account__danger-row">
        <div class="account__danger-copy">
          <p class="account__danger-title">Delete all chats</p>
          <p class="account__card-subtitle">
            Permanently delete every conversation and its messages. This can’t be
            undone.
          </p>
        </div>

        @if (confirmingDeleteChats()) {
          <div class="account__danger-confirm">
            <cog-button
              appearance="danger"
              [disabled]="deletingChats()"
              (click)="deleteAllChats()"
            >
              {{ deletingChats() ? 'Deleting…' : 'Yes, delete everything' }}
            </cog-button>
            <cog-button
              appearance="subtle"
              [disabled]="deletingChats()"
              (click)="confirmingDeleteChats.set(false)"
            >
              Cancel
            </cog-button>
          </div>
        } @else {
          <cog-button appearance="danger" (click)="confirmingDeleteChats.set(true)">
            Delete all chats
          </cog-button>
        }
      </div>

      <hr class="account__danger-divider" />

      <div class="account__danger-row">
        <div class="account__danger-copy">
          <p class="account__danger-title">Delete account</p>
          <p class="account__card-subtitle">
            Permanently delete your account, chats, keys and personas. Billing records
            are retained for accounting. This can’t be undone.
          </p>

          @if (confirmingDeleteAccount()) {
            <div class="account__field account__danger-confirm-field">
              <span class="account__hint">
                Type <strong>DELETE</strong> to confirm.
              </span>
              <cog-text-field
                ariaLabel="Type DELETE to confirm"
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
              {{ deletingAccount() ? 'Deleting…' : 'Delete my account' }}
            </cog-button>
            <cog-button
              appearance="subtle"
              [disabled]="deletingAccount()"
              (click)="cancelDeleteAccount()"
            >
              Cancel
            </cog-button>
          </div>
        } @else {
          <cog-button appearance="danger" (click)="confirmingDeleteAccount.set(true)">
            Delete account
          </cog-button>
        }
      </div>
    </section>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-200, 16px);
      max-width: 920px;
    }

    .account__header {
      display: grid;
      gap: var(--cog-space-050);
      margin: var(--cog-space-150) 0 0;
    }

    .account__title {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-h-lg);
      font-weight: var(--cog-fw-h-lg);
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
          this._toast.notify({ title: 'Profile updated' });
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
        this._toast.notify({ title: 'Password changed' });
      },
      error: () => {
        this.changingPassword.set(false);
        this.passwordError.set(
          'Could not change your password. Check your current password and try again.',
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
          title: deleted === 1 ? 'Deleted 1 chat' : `Deleted ${deleted} chats`,
        });
      },
      error: () => {
        this.deletingChats.set(false);
        this._toast.notify({ title: 'Could not delete chats', tone: 'danger' });
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
              ? 'Exported 1 chat'
              : `Exported ${conversation_count} chats`,
        });
      })
      .catch(() => {
        this._toast.notify({ title: 'Could not export your data', tone: 'danger' });
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
        this._toast.notify({ title: 'Your account has been deleted' });
        await this._router.navigate(['/', 'auth', 'login']);
      },
      error: (error: unknown) => {
        this.deletingAccount.set(false);
        const conflict = (error as { status?: number })?.status === 409;
        this._toast.notify({
          title: conflict
            ? 'Cancel your plan before deleting your account'
            : 'Could not delete your account',
          tone: 'danger',
        });
      },
    });
  }
}
