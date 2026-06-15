import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import {
  type CognosBreadcrumbItem,
  CognosBreadcrumbsComponent,
} from '../../navigation/breadcrumbs/breadcrumbs.component';

@Component({
  selector: 'cog-desktop-shell',
  standalone: true,
  imports: [CognosBreadcrumbsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.cog-desktop-shell-host--fill]': 'fillViewport()',
  },
  template: `
    <section [class]="shellClass()">
      <aside [class]="navClass()">
        <div class="cog-desktop-shell__nav-body">
          <ng-content select="[cogDesktopNav]" />
        </div>

        @if (navFooter()) {
          <footer class="cog-desktop-shell__nav-footer">
            <ng-content select="[cogDesktopNavFooter]" />
          </footer>
        }
      </aside>

      <div class="cog-desktop-shell__content">
        @if (showHeader()) {
          <header class="cog-desktop-shell__header">
            <div class="cog-desktop-shell__heading">
              <cog-breadcrumbs [items]="breadcrumbs()" />
              <h1 class="cog-desktop-shell__title">{{ title() }}</h1>
            </div>

            <div class="cog-desktop-shell__actions">
              <ng-content select="[cogDesktopActions]" />
            </div>
          </header>
        }

        <main [class]="mainClass()">
          <ng-content />
        </main>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
      }

      /* Fixed-viewport mode: the shell fills the screen and the content area
         scrolls internally (for app views with their own header/composer). */
      :host(.cog-desktop-shell-host--fill) {
        height: 100vh;
        height: 100svh;
        min-height: 0;
        overflow: hidden;
      }

      .cog-desktop-shell {
        display: grid;
        min-height: 100vh;
        grid-template-columns: 290px minmax(0, 1fr);
        background: var(--cog-app-bg);
      }

      .cog-desktop-shell--fill {
        min-height: 0;
        height: 100%;
        overflow: hidden;
      }

      .cog-desktop-shell--fill .cog-desktop-shell__nav {
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }

      .cog-desktop-shell--fill .cog-desktop-shell__content {
        min-height: 0;
        height: 100%;
        overflow: hidden;
      }

      .cog-desktop-shell--fill .cog-desktop-shell__main {
        min-height: 0;
        overflow: hidden;
      }

      .cog-desktop-shell__nav {
        display: grid;
        border-right: 1px solid var(--cog-border);
        background: var(--cog-nav-bg);
      }

      .cog-desktop-shell__nav--footer {
        grid-template-rows: minmax(0, 1fr) auto;
      }

      .cog-desktop-shell__nav-body {
        overflow: auto;
        padding: var(--cog-space-200);
      }

      .cog-desktop-shell__nav-footer {
        border-top: 1px solid var(--cog-border);
        background: var(--cog-nav-bg);
        padding: var(--cog-space-150) var(--cog-space-200);
      }

      .cog-desktop-shell__content {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .cog-desktop-shell__main {
        flex: 1;
        min-width: 0;
        padding: 0 var(--cog-space-300) var(--cog-space-300);
      }

      .cog-desktop-shell__main--flush {
        padding: 0;
      }

      .cog-desktop-shell__header {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: var(--cog-space-200);
        padding: var(--cog-space-200) var(--cog-space-300);
      }

      .cog-desktop-shell__heading {
        display: grid;
        gap: var(--cog-space-050);
      }

      .cog-desktop-shell__title {
        margin: 0;
        color: var(--cog-text);
        font-size: var(--cog-fs-h-md);
        font-weight: var(--cog-fw-h-md);
        line-height: var(--cog-lh-h-md);
      }

      .cog-desktop-shell__actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--cog-space-100);
      }
    `,
  ],
})
export class CognosDesktopShellComponent {
  readonly breadcrumbs = input<CognosBreadcrumbItem[]>([]);
  readonly title = input('Workspace');
  readonly navFooter = input(false);
  /** Render the built-in breadcrumb + title header. Off when the view supplies
   * its own header (e.g. a chat header) inside the content. */
  readonly showHeader = input(true);
  /** Fill the viewport and scroll the content internally, instead of letting
   * the whole page scroll. */
  readonly fillViewport = input(false);
  /** Pad the content area. Off for full-bleed content (e.g. a chat view). */
  readonly padded = input(true);

  protected readonly shellClass = computed(() =>
    this.fillViewport()
      ? 'cog-desktop-shell cog-desktop-shell--fill'
      : 'cog-desktop-shell',
  );

  protected readonly navClass = computed(() => {
    const classes = ['cog-desktop-shell__nav'];

    if (this.navFooter()) {
      classes.push('cog-desktop-shell__nav--footer');
    }

    return classes.join(' ');
  });

  protected readonly mainClass = computed(() => {
    const classes = ['cog-desktop-shell__main'];

    if (!this.padded()) {
      classes.push('cog-desktop-shell__main--flush');
    }

    return classes.join(' ');
  });
}
