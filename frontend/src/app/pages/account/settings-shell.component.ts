import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { CognosIconComponent } from '@cognos/ui-angular';
import type { CognosIconName } from '@cognos/ui/icons';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';

interface SettingsNavItem {
  label: string;
  path: string;
  icon: CognosIconName;
}

// SettingsShellComponent is the layout for the account/settings area: it swaps
// the chat sidebar for a Settings nav and hosts the settings pages. Each page
// renders its own breadcrumb + title in the content area.
@Component({
  selector: 'app-settings-shell',
  standalone: true,
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    CognosIconComponent,
    CognosLogoComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="settings">
      <aside class="settings__sidebar">
        <div class="settings__brand">
          <app-cognos-logo palette="dark"></app-cognos-logo>
        </div>

        <a class="settings__back" routerLink="/">
          <cog-icon name="chevron-left" [size]="16" tone="current" />
          Back to chats
        </a>

        <nav class="settings__nav" aria-label="Settings">
          <div class="settings__nav-heading">Settings</div>
          @for (item of navItems; track item.path) {
            <a
              class="settings__nav-item"
              [routerLink]="item.path"
              routerLinkActive="settings__nav-item--active"
            >
              <cog-icon [name]="item.icon" [size]="18" tone="current" />
              {{ item.label }}
            </a>
          }
        </nav>
      </aside>

      <main class="settings__content">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100vh;
      height: 100svh;
      background: var(--cog-app-bg);
    }

    .settings {
      display: grid;
      grid-template-columns: 264px minmax(0, 1fr);
      height: 100%;
    }

    .settings__sidebar {
      display: grid;
      grid-template-rows: auto auto 1fr;
      gap: var(--cog-space-150);
      border-right: 1px solid var(--cog-border);
      background: var(--cog-nav-bg);
      padding: var(--cog-space-200);
      overflow-y: auto;
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

    .settings__nav {
      display: grid;
      gap: 2px;
      align-content: start;
    }

    .settings__nav-heading {
      padding: var(--cog-space-100) var(--cog-space-100) var(--cog-space-050);
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      letter-spacing: var(--cog-ls-overline);
      text-transform: uppercase;
    }

    .settings__nav-item {
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
      border-radius: var(--cog-radius-sm);
      padding: var(--cog-space-100) var(--cog-space-100);
      color: var(--cog-text);
      font-size: var(--cog-fs-body-sm);
      font-weight: var(--cog-fw-medium, 500);
      text-decoration: none;
    }

    .settings__nav-item:hover {
      background: var(--cog-surface-hover, rgba(0, 0, 0, 0.04));
    }

    .settings__nav-item--active {
      background: var(--cog-selected-bg, rgba(46, 160, 67, 0.12));
      color: var(--cog-selected-text, var(--cog-text));
    }

    .settings__content {
      min-height: 0;
      overflow-y: auto;
      padding: var(--cog-space-300);
    }

    @media (max-width: 767px) {
      .settings {
        grid-template-columns: 1fr;
      }

      .settings__sidebar {
        display: none;
      }

      .settings__content {
        padding: var(--cog-space-200);
      }
    }
  `,
})
export class SettingsShellComponent {
  protected readonly navItems: SettingsNavItem[] = [
    { label: 'Account', path: 'account', icon: 'user-plus' },
    { label: 'Plan & billing', path: 'billing', icon: 'landmark' },
    { label: 'Usage', path: 'usage', icon: 'file-text' },
    { label: 'Security & keys', path: 'security', icon: 'shield' },
    { label: 'Team & sharing', path: 'team', icon: 'users' },
    { label: 'Notifications', path: 'notifications', icon: 'mail' },
  ];
}
