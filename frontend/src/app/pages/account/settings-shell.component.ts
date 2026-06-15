import { Dialog } from '@angular/cdk/dialog';
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

import {
  CognosButtonComponent,
  CognosDrawerComponent,
  CognosIconButtonComponent,
  CognosIconComponent,
  CognosToastService,
} from '@cognos/ui-angular';
import type { CognosIconName } from '@cognos/ui/icons';

import { SidebarProfileComponent } from '@app/components/chat/sidebar-profile/sidebar-profile.component';
import { TrialCreditCardComponent } from '@app/components/chat/trial-credit-card/trial-credit-card.component';
import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { ContactHelpDialogComponent } from '@app/components/contact-help-dialog/contact-help-dialog.component';
import { BillingService } from '@app/services/billing.service';
import { VaultService } from '@app/services/vault.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

interface SettingsNavItem {
  label: string;
  path: string;
  icon: CognosIconName;
}

// SettingsShellComponent is the same app shell as the chat view — same width,
// logo, account actions, profile footer, and the mobile hamburger-drawer — with
// the conversation list + search swapped for the Settings nav.
@Component({
  selector: 'app-settings-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    CognosButtonComponent,
    CognosDrawerComponent,
    CognosIconButtonComponent,
    CognosIconComponent,
    CognosLogoComponent,
    SidebarProfileComponent,
    TrialCreditCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #brand>
      <div class="settings__brand">
        <app-cognos-logo class="settings__logo" palette="dark"></app-cognos-logo>
      </div>
    </ng-template>

    <ng-template #back>
      <a class="settings__back" routerLink="/">
        <cog-icon name="chevron-left" [size]="16" tone="current" />
        Back to chats
      </a>
    </ng-template>

    <ng-template #menu>
      <nav class="settings__menu" aria-label="Settings">
        <div class="settings__menu-heading">Settings</div>
        @for (item of navItems; track item.path) {
          <a
            class="settings__menu-item"
            [routerLink]="item.path"
            routerLinkActive="settings__menu-item--active"
          >
            <cog-icon [name]="item.icon" [size]="18" tone="current" />
            {{ item.label }}
          </a>
        }
      </nav>
    </ng-template>

    <ng-template #actions>
      <div class="settings__nav-actions">
        <cog-button appearance="subtle" type="button" (click)="onOpenHelpDialog()">
          Help
        </cog-button>
        <cog-button
          appearance="subtle"
          icon="lock"
          title="Locks your account and does not log you out."
          type="button"
          (click)="onLock()"
        >
          Lock
        </cog-button>
        <cog-button appearance="subtle" type="button" (click)="onLogout()">
          Log out
        </cog-button>
      </div>
    </ng-template>

    <ng-template #footer>
      @if (billing.isTrial()) {
        <app-trial-credit-card></app-trial-credit-card>
      }
      <app-sidebar-profile></app-sidebar-profile>
    </ng-template>

    <div class="settings">
      <aside class="settings__sidebar">
        <div class="settings__nav">
          <ng-container *ngTemplateOutlet="brand"></ng-container>
          <ng-container *ngTemplateOutlet="back"></ng-container>
          <ng-container *ngTemplateOutlet="menu"></ng-container>
        </div>
        <div class="settings__actions">
          <ng-container *ngTemplateOutlet="actions"></ng-container>
        </div>
        <div class="settings__footer">
          <ng-container *ngTemplateOutlet="footer"></ng-container>
        </div>
      </aside>

      <div class="settings__main">
        <header class="settings__mobile-bar">
          <cog-icon-button
            name="menu"
            size="lg"
            title="Open navigation"
            (click)="openDrawer()"
          />
          <app-cognos-logo
            class="settings__mobile-logo"
            palette="dark"
          ></app-cognos-logo>
          <div class="settings__mobile-actions"></div>
        </header>

        <main class="settings__content">
          <router-outlet></router-outlet>
        </main>
      </div>

      <cog-drawer
        [open]="drawerOpen()"
        [stickyFooter]="true"
        title="Settings"
        [hideTitle]="true"
        (close)="closeDrawer()"
      >
        <app-cognos-logo
          cogDrawerHeader
          class="settings__drawer-logo"
          palette="dark"
        ></app-cognos-logo>

        <div class="settings__drawer-body">
          <ng-container *ngTemplateOutlet="back"></ng-container>
          <ng-container *ngTemplateOutlet="menu"></ng-container>
        </div>

        <div cogDrawerFooter>
          <ng-container *ngTemplateOutlet="actions"></ng-container>
          <ng-container *ngTemplateOutlet="footer"></ng-container>
        </div>
      </cog-drawer>
    </div>
  `,
  styles: `
    :host {
      display: block;
      background: var(--cog-app-bg);
    }

    .settings__sidebar {
      background: var(--cog-nav-bg);
    }

    .settings__nav {
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      gap: var(--cog-space-150);
      padding: var(--cog-space-200);
      min-height: 0;
      overflow-y: auto;
    }

    .settings__brand {
      display: flex;
      align-items: center;
    }

    .settings__logo,
    .settings__mobile-logo,
    .settings__drawer-logo {
      display: block;
      height: 24px;
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
      gap: 2px;
      align-content: start;
      min-height: 0;
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
      background: var(--cog-surface-hover, rgba(0, 0, 0, 0.04));
    }

    .settings__menu-item--active {
      background: var(--cog-selected-bg, rgba(46, 160, 67, 0.12));
      color: var(--cog-selected-text, var(--cog-text));
    }

    .settings__actions {
      padding: var(--cog-space-100) var(--cog-space-200) var(--cog-space-150);
    }

    .settings__nav-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: var(--cog-space-050);
      width: 100%;
    }

    .settings__footer {
      display: grid;
      gap: var(--cog-space-150);
      border-top: 1px solid var(--cog-border);
      padding: var(--cog-space-150) var(--cog-space-200);
    }

    .settings__main {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      height: 100%;
      min-height: 0;
    }

    .settings__mobile-bar {
      display: none;
    }

    .settings__mobile-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--cog-space-050);
    }

    .settings__content {
      min-height: 0;
      overflow-y: auto;
      padding: var(--cog-space-300);
    }

    cog-drawer [cogDrawerFooter] {
      display: grid;
      gap: var(--cog-space-150);
    }

    .settings__drawer-body {
      display: grid;
      gap: var(--cog-space-150);
    }

    @media (min-width: 768px) {
      .settings {
        display: grid;
        grid-template-columns: 304px minmax(0, 1fr);
        height: 100vh;
        height: 100svh;
        overflow: hidden;
      }

      .settings__sidebar {
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto auto;
        border-right: 1px solid var(--cog-border);
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }
    }

    @media (max-width: 767px) {
      .settings {
        height: 100vh;
        height: 100svh;
        overflow: hidden;
      }

      .settings__sidebar {
        display: none;
      }

      .settings__mobile-bar {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--cog-space-100);
        min-height: 56px;
        border-bottom: 1px solid var(--cog-border);
        background: var(--cog-nav-bg);
        padding: 0 var(--cog-space-200);
      }

      .settings__content {
        padding: var(--cog-space-200);
      }
    }
  `,
})
export class SettingsShellComponent {
  private readonly _dialog = inject(Dialog);
  private readonly _vaultService = inject(VaultService);
  private readonly _toastService = inject(CognosToastService);
  private readonly _router = inject(Router);
  public readonly billing = inject(BillingService);

  readonly drawerOpen = signal(false);

  protected readonly navItems: SettingsNavItem[] = [
    { label: 'Account', path: 'account', icon: 'user-plus' },
    { label: 'Plan & billing', path: 'billing', icon: 'landmark' },
    { label: 'Usage', path: 'usage', icon: 'file-text' },
    { label: 'Security & keys', path: 'security', icon: 'shield' },
    { label: 'Team & sharing', path: 'team', icon: 'users' },
    { label: 'Notifications', path: 'notifications', icon: 'mail' },
  ];

  constructor() {
    // Close the drawer after navigating, like the chat shell.
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

  protected onOpenHelpDialog(): void {
    this._dialog.open(ContactHelpDialogComponent, cognosDialogOptions);
  }

  protected onLock(): void {
    this.drawerOpen.set(false);
    this._vaultService.lock();
    this._toastService.notify({
      title: 'Account locked',
      msg: 'This device now needs your password and Account Key to unlock again.',
      tone: 'info',
      icon: 'lock',
      duration: 4200,
    });
  }

  protected onLogout(): void {
    this.drawerOpen.set(false);
    void this._router.navigate(['', 'auth', 'logout']);
  }
}
