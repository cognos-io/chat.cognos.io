import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';

import {
  CognosAvatarComponent,
  CognosBreadcrumbsComponent,
  CognosButtonComponent,
  CognosIconComponent,
  CognosTextFieldComponent,
  CognosToastService,
} from '@cognos/ui-angular';

import {
  AvatarColor,
  AvatarIcon,
  avatarColors,
  avatarIcons,
  coerceAvatarColor,
  coerceAvatarIcon,
} from '@app/interfaces/avatar';
import { AuthService } from '@app/services/auth.service';
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

      <div class="account__profile">
        <cog-avatar
          [name]="avatarName()"
          [icon]="avatarIcon() ?? null"
          [color]="avatarIcon() ? avatarColor() : ''"
          [size]="40"
        />

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
            <legend class="account__label">Avatar icon</legend>
            <div class="account__icon-grid" role="radiogroup" aria-label="Avatar icon">
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
          </fieldset>

          <fieldset class="account__field account__fieldset">
            <legend class="account__label">Avatar colour</legend>
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
          </fieldset>
        </div>
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
  `,
  styles: `
    :host {
      display: block;
      max-width: 920px;
    }

    .account__header {
      display: grid;
      gap: var(--cog-space-050);
      margin: var(--cog-space-150) 0 var(--cog-space-250, 20px);
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

    .account__profile {
      display: flex;
      gap: var(--cog-space-200, 16px);
      align-items: flex-start;
      margin-top: var(--cog-space-100);
    }

    .account__fields {
      display: grid;
      gap: var(--cog-space-150);
      flex: 1;
      min-width: 0;
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

    .account__fieldset {
      margin: 0;
      padding: 0;
      border: 0;
    }

    .account__icon-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
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
  `,
})
export class AccountComponent {
  private readonly _auth = inject(AuthService);
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
}
