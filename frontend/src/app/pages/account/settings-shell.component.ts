import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';

import { filter } from 'rxjs';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosDesktopShellComponent,
  CognosIconComponent,
  CognosMobileShellComponent,
} from '@cognos/ui-angular';
import type { CognosIconName } from '@cognos/ui/icons';

import { SidebarProfileComponent } from '@app/components/chat/sidebar-profile/sidebar-profile.component';
import { TrialCreditCardComponent } from '@app/components/chat/trial-credit-card/trial-credit-card.component';
import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { SidebarAccountActionsComponent } from '@app/components/sidebar-account-actions/sidebar-account-actions.component';
import { SidebarBrandComponent } from '@app/components/sidebar-brand/sidebar-brand.component';
import { VaultUnlockGateDirective } from '@app/directives/vault-unlock-gate.directive';
import { FeatureFlag } from '@app/guards/feature-flag.guard';
import { BillingService } from '@app/services/billing.service';
import { DeviceService } from '@app/services/device.service';

import { environment } from '@environments/environment';

interface SettingsNavItem {
  // i18n key under `settings.nav.*` for the menu label.
  labelKey: string;
  link: string;
  icon: CognosIconName;
  // Match the link exactly (used for the /account home so it isn't active on
  // every child route).
  exact?: boolean;
  // When set, the item only appears if the matching build-time feature flag is
  // on. Unflagged items (Account, Plan & billing) always show.
  flag?: FeatureFlag;
}

// SettingsShellComponent composes the shared ui-angular app shell
// (cog-desktop-shell / cog-mobile-shell) with the Settings nav, account
// actions, and profile footer. The chat view uses the same shells — this is the
// single source of truth for the frame. Each settings page renders its own
// breadcrumb + title in the content, so the shell's built-in header is off.
@Component({
  selector: 'app-settings-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    CognosDesktopShellComponent,
    CognosMobileShellComponent,
    CognosIconComponent,
    CognosLogoComponent,
    SidebarProfileComponent,
    TrialCreditCardComponent,
    SidebarAccountActionsComponent,
    SidebarBrandComponent,
    TranslocoModule,
  ],
  // Prompt for the Account Key when the vault is locked on any settings route
  // (e.g. Projects needs it to decrypt) — the chat shell carries the same gate.
  hostDirectives: [VaultUnlockGateDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <ng-template #brand>
        <app-sidebar-brand />
      </ng-template>

      <ng-template #back>
        <a class="settings__back" routerLink="/">
          <cog-icon name="chevron-left" [size]="16" tone="current" />
          {{ t('settings.backToChats') }}
        </a>
      </ng-template>

      <ng-template #menu>
        <nav class="settings__menu" [attr.aria-label]="t('settings.title')">
          <div class="settings__menu-heading">{{ t('settings.title') }}</div>
          @for (item of navItems; track item.link) {
            <a
              class="settings__menu-item"
              [routerLink]="item.link"
              routerLinkActive="settings__menu-item--active"
              [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
            >
              <cog-icon [name]="item.icon" [size]="18" tone="current" />
              {{ t(item.labelKey) }}
            </a>
          }
        </nav>
      </ng-template>

      <ng-template #actions>
        <app-sidebar-account-actions (actioned)="closeDrawer()" />
      </ng-template>

      <ng-template #footer>
        @if (billing.isTrial()) {
          <app-trial-credit-card></app-trial-credit-card>
        }
        <app-sidebar-profile></app-sidebar-profile>
      </ng-template>

      @if (device.isMobile()) {
        <cog-mobile-shell
          [fillViewport]="true"
          title=""
          [drawerTitle]="t('settings.title')"
          [drawerOpen]="drawerOpen()"
          [drawerFooter]="true"
          (menuClick)="openDrawer()"
          (drawerClose)="closeDrawer()"
        >
          <app-cognos-logo cogMobileBrand class="settings__logo" palette="dark" />

          <router-outlet></router-outlet>

          <div cogMobileDrawer class="settings__drawer">
            <ng-container *ngTemplateOutlet="back"></ng-container>
            <ng-container *ngTemplateOutlet="menu"></ng-container>
          </div>
          <div cogMobileDrawerFooter class="settings__navfooter">
            <ng-container *ngTemplateOutlet="actions"></ng-container>
            <ng-container *ngTemplateOutlet="footer"></ng-container>
          </div>
        </cog-mobile-shell>
      } @else {
        <cog-desktop-shell
          [navFooter]="true"
          [showHeader]="false"
          [fillViewport]="true"
          [padded]="false"
        >
          <div cogDesktopNav class="settings__nav">
            <ng-container *ngTemplateOutlet="brand"></ng-container>
            <ng-container *ngTemplateOutlet="back"></ng-container>
            <ng-container *ngTemplateOutlet="menu"></ng-container>
          </div>

          <div cogDesktopNavFooter class="settings__navfooter">
            <ng-container *ngTemplateOutlet="actions"></ng-container>
            <ng-container *ngTemplateOutlet="footer"></ng-container>
          </div>

          <!-- The shell's main area is overflow:hidden under fillViewport, so the
             settings content needs its own scroll container or long pages clip. -->
          <div class="settings__content">
            <router-outlet></router-outlet>
          </div>
        </cog-desktop-shell>
      }
    </ng-container>
  `,
  styles: `
    .settings__content {
      height: 100%;
      overflow-y: auto;
      padding: 0 var(--cog-space-300) var(--cog-space-300);
    }

    .settings__logo {
      display: block;
      height: 24px;
    }

    .settings__nav {
      display: grid;
      gap: var(--cog-space-150);
    }

    .settings__back {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      text-decoration: none;
    }

    .settings__back:hover {
      color: var(--cog-text);
    }

    .settings__menu {
      display: grid;
      gap: var(--cog-space-025);
      align-content: start;
    }

    .settings__menu-heading {
      padding: var(--cog-space-100) var(--cog-space-100) var(--cog-space-050);
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      letter-spacing: var(--cog-ls-overline);
      text-transform: uppercase;
    }

    .settings__menu-item {
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
      border-radius: var(--cog-radius-sm);
      padding: var(--cog-space-100);
      color: var(--cog-text);
      font-size: var(--cog-fs-body-sm);
      text-decoration: none;
    }

    .settings__menu-item:hover {
      background: var(--cog-surface-hover);
    }

    .settings__menu-item--active {
      background: var(--cog-selected-bg);
      color: var(--cog-selected-text);
    }

    .settings__navfooter,
    .settings__drawer {
      display: grid;
      gap: var(--cog-space-150);
    }
  `,
})
export class SettingsShellComponent {
  private readonly _router = inject(Router);
  public readonly billing = inject(BillingService);
  public readonly device = inject(DeviceService);

  readonly drawerOpen = signal(false);

  // The full set of settings sections. Flagged-off sections are filtered out of
  // `navItems` so they never render in the nav (their routes also redirect).
  private readonly _allNavItems: SettingsNavItem[] = [
    {
      labelKey: 'settings.nav.account',
      link: '/account',
      icon: 'user-plus',
      exact: true,
    },
    { labelKey: 'settings.nav.memory', link: '/account/memory', icon: 'brain' },
    { labelKey: 'settings.nav.library', link: '/account/library', icon: 'folder' },
    { labelKey: 'settings.nav.billing', link: '/account/billing', icon: 'landmark' },
    {
      labelKey: 'settings.nav.projects',
      link: '/account/projects',
      icon: 'folder',
      flag: 'projects',
    },
    {
      labelKey: 'settings.nav.usage',
      link: '/account/usage',
      icon: 'file-text',
      flag: 'usage',
    },
    {
      labelKey: 'settings.nav.security',
      link: '/account/security',
      icon: 'shield',
      flag: 'security',
    },
    {
      labelKey: 'settings.nav.team',
      link: '/account/team',
      icon: 'users',
      flag: 'team',
    },
    {
      labelKey: 'settings.nav.notifications',
      link: '/account/notifications',
      icon: 'mail',
      flag: 'notifications',
    },
  ];

  protected readonly navItems: SettingsNavItem[] = this._allNavItems.filter(
    (item) => !item.flag || environment.featureFlags[item.flag],
  );

  constructor() {
    this._router.events
      .pipe(
        takeUntilDestroyed(),
        filter((event) => event instanceof NavigationEnd),
      )
      .subscribe(() => this.drawerOpen.set(false));
  }

  openDrawer(): void {
    this.drawerOpen.set(true);
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
  }
}
