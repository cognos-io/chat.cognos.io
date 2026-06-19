import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosAvatarComponent,
  CognosIconComponent,
  CognosLozengeComponent,
} from '@cognos/ui-angular';

import { coerceAvatarColor, coerceAvatarIcon } from '@app/interfaces/avatar';
import { BillingPlanType } from '@app/interfaces/billing';
import { AuthService } from '@app/services/auth.service';
import { BillingService } from '@app/services/billing.service';
import { deriveProfileName } from '@app/utils/profile-identity';

const PLAN_LABEL_KEYS: Record<BillingPlanType, string> = {
  trial: 'chat.sidebar.plan.trial',
  payg: 'chat.sidebar.plan.payg',
  unlimited: 'chat.sidebar.plan.unlimited',
  inactive: 'chat.sidebar.plan.inactive',
};

// SidebarProfileComponent replaces the old security footer with a profile +
// plan affordance (the mockup): an avatar, the plan, and — for trial — the
// remaining credit shown prominently. The whole row links to the billing page.
// Identity stays privacy-preserving: only initials are shown until the user
// sets a display name (the field arrives with the Paddle schema work).
@Component({
  selector: 'app-sidebar-profile',
  standalone: true,
  imports: [
    RouterLink,
    CognosAvatarComponent,
    CognosIconComponent,
    CognosLozengeComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      *transloco="let t"
      class="sidebar-profile"
      routerLink="/account"
      [attr.aria-label]="t('chat.sidebar.accountBilling')"
    >
      <cog-avatar
        class="sidebar-profile__avatar"
        [name]="avatarName()"
        [icon]="avatarIcon() ?? null"
        [color]="avatarIcon() ? avatarColor() : ''"
        [size]="36"
      />

      <span class="sidebar-profile__body">
        @if (displayName()) {
          <span class="sidebar-profile__name">{{ displayName() }}</span>
        }

        <span class="sidebar-profile__plan">
          <cog-lozenge [tone]="planTone()">{{ planLabel() }}</cog-lozenge>
          @if (billing.isTrial()) {
            <span class="sidebar-profile__credit">
              {{
                t('chat.sidebar.creditLeft', {
                  amount: billing.balanceChf().toFixed(2),
                })
              }}
            </span>
          }
        </span>
      </span>

      <cog-icon
        class="sidebar-profile__shop"
        name="landmark"
        [size]="18"
        tone="text-subtle"
        [title]="t('chat.sidebar.viewPlans')"
      />
    </a>
  `,
  styles: `
    .sidebar-profile {
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
      width: 100%;
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface);
      padding: var(--cog-space-100) var(--cog-space-150);
      text-decoration: none;
      color: var(--cog-text);
      transition: background-color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .sidebar-profile:hover,
    .sidebar-profile:focus-visible {
      background: var(--cog-surface-hover, rgba(0, 0, 0, 0.04));
      outline: 0;
    }

    .sidebar-profile__body {
      display: grid;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }

    .sidebar-profile__name {
      font-weight: var(--cog-fw-semibold);
      font-size: var(--cog-fs-body-sm);
      line-height: var(--cog-lh-body-sm);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sidebar-profile__plan {
      display: flex;
      align-items: center;
      gap: var(--cog-space-075);
      min-width: 0;
    }

    .sidebar-profile__credit {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
      white-space: nowrap;
    }

    .sidebar-profile__shop {
      flex: none;
    }
  `,
})
export class SidebarProfileComponent {
  private readonly _auth = inject(AuthService);
  private readonly _transloco = inject(TranslocoService);
  public readonly billing = inject(BillingService);

  // The persisted display name (arrives with the Paddle schema migration);
  // undefined until then, which keeps the row showing initials + plan only.
  private readonly _displayName = computed(
    () => (this._auth.user() as { display_name?: string } | null)?.display_name ?? '',
  );

  readonly displayName = computed(() => this._displayName().trim());

  // Feeds the avatar's initials/aria — derived, never rendered as raw email.
  readonly avatarName = computed(() =>
    deriveProfileName(this._displayName(), this._auth.email()),
  );

  // The chosen icon avatar (icon + colour); undefined icon falls back to initials.
  readonly avatarIcon = computed(() =>
    coerceAvatarIcon(this._auth.user()?.['avatar_icon']),
  );
  readonly avatarColor = computed(() =>
    coerceAvatarColor(this._auth.user()?.['avatar_color']),
  );

  planLabel(): string {
    const plan = this.billing.planType();
    return plan
      ? this._transloco.translate(PLAN_LABEL_KEYS[plan])
      : this._transloco.translate('chat.sidebar.plan.loading');
  }

  planTone(): 'blue' | 'green' | 'neutral' {
    switch (this.billing.planType()) {
      case 'trial':
        return 'blue';
      case 'payg':
      case 'unlimited':
        return 'green';
      default:
        return 'neutral';
    }
  }
}
