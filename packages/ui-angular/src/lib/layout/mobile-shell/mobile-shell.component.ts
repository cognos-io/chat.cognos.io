import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import { CognosDrawerComponent } from '../../navigation/drawer/drawer.component';
import { CognosIconButtonComponent } from '../../primitives/icon-button/icon-button.component';

@Component({
  selector: 'cog-mobile-shell',
  standalone: true,
  imports: [CognosDrawerComponent, CognosIconButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.cog-mobile-shell-host--fill]': 'fillViewport()',
  },
  template: `
    <section [class]="shellClass()">
      <header class="cog-mobile-shell__bar">
        @if (showMenuButton()) {
          <cog-icon-button
            name="menu"
            size="lg"
            title="Open navigation"
            (click)="onMenuClick()"
          />
        }

        <div class="cog-mobile-shell__brand">
          <ng-content select="[cogMobileBrand]" />
          @if (title()) {
            <h1 class="cog-mobile-shell__title">{{ title() }}</h1>
          }
        </div>

        <div class="cog-mobile-shell__actions">
          <ng-content select="[cogMobileActions]" />
        </div>
      </header>

      <main class="cog-mobile-shell__main">
        <ng-content />
      </main>

      <div class="cog-mobile-shell__composer">
        <ng-content select="[cogMobileComposer]" />
      </div>

      <cog-drawer
        [open]="drawerOpen()"
        [stickyFooter]="drawerFooter()"
        [title]="drawerTitle()"
        (close)="onDrawerClose()"
      >
        <ng-content select="[cogMobileDrawer]" />

        @if (drawerFooter()) {
          <div cogDrawerFooter>
            <ng-content select="[cogMobileDrawerFooter]" />
          </div>
        }
      </cog-drawer>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
      }

      :host(.cog-mobile-shell-host--fill) {
        height: 100vh;
        height: 100svh;
        min-height: 0;
        overflow: hidden;
      }

      .cog-mobile-shell {
        display: grid;
        min-height: 100vh;
        grid-template-rows: 56px minmax(0, 1fr) auto;
        background: var(--cog-app-bg);
      }

      .cog-mobile-shell--fill {
        min-height: 0;
        height: 100%;
        overflow: hidden;
      }

      .cog-mobile-shell--fill .cog-mobile-shell__main {
        min-height: 0;
        overflow-y: auto;
      }

      .cog-mobile-shell__brand {
        display: flex;
        align-items: center;
        gap: var(--cog-space-100);
        min-width: 0;
      }

      .cog-mobile-shell__bar {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--cog-space-100);
        padding: 0 var(--cog-space-200);
        background: var(--cog-nav-bg);
        border-bottom: 1px solid var(--cog-border);
      }

      .cog-mobile-shell__title {
        margin: 0;
        color: var(--cog-text);
        font-size: var(--cog-fs-h-sm);
        font-weight: var(--cog-fw-h-sm);
        line-height: var(--cog-lh-h-sm);
      }

      .cog-mobile-shell__actions {
        display: flex;
        gap: var(--cog-space-050);
      }

      .cog-mobile-shell__main {
        padding: var(--cog-space-200);
      }

      .cog-mobile-shell__composer {
        position: sticky;
        bottom: 0;
        padding: var(--cog-space-100) var(--cog-space-200)
          calc(var(--cog-space-100) + env(safe-area-inset-bottom));
        background: linear-gradient(
          180deg,
          transparent 0,
          color-mix(in srgb, var(--cog-app-bg) 88%, transparent) 18px,
          var(--cog-app-bg) 100%
        );
      }
    `,
  ],
})
export class CognosMobileShellComponent {
  readonly title = input('Cognos');
  readonly drawerOpen = input(false);
  readonly drawerTitle = input('Navigation');
  readonly drawerFooter = input(false);
  readonly showMenuButton = input(true);
  /** Fill the viewport and scroll the main area internally. */
  readonly fillViewport = input(false);
  readonly menuClick = output<void>();
  readonly drawerClose = output<void>();

  protected readonly shellClass = computed(() =>
    this.fillViewport()
      ? 'cog-mobile-shell cog-mobile-shell--fill'
      : 'cog-mobile-shell',
  );

  protected onMenuClick(): void {
    this.menuClick.emit();
  }

  protected onDrawerClose(): void {
    this.drawerClose.emit();
  }
}
