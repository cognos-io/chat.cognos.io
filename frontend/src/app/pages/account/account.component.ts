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
  CognosTextFieldComponent,
  CognosToastService,
} from '@cognos/ui-angular';

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
        <cog-avatar [name]="avatarName()" [size]="40" />

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

  // The persisted display name, read live from the auth record.
  private readonly _persistedDisplayName = computed(
    () => (this._auth.user()?.['display_name'] as string | undefined)?.trim() ?? '',
  );

  // The editable draft, seeded from the persisted value.
  protected readonly displayName = signal(this._persistedDisplayName());

  protected readonly saving = signal(false);

  protected readonly dirty = computed(
    () => this.displayName().trim() !== this._persistedDisplayName(),
  );

  protected readonly avatarName = computed(() =>
    deriveProfileName(this.displayName(), this.email()),
  );

  save(): void {
    if (this.saving() || !this.dirty()) {
      return;
    }

    this.saving.set(true);
    this._auth.updateProfile({ display_name: this.displayName().trim() }).subscribe({
      next: () => {
        this.saving.set(false);
        this._toast.notify({ title: 'Profile updated' });
      },
      error: () => this.saving.set(false),
    });
  }
}
