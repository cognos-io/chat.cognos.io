import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";

import {
  CognosBreadcrumbsComponent,
  type CognosBreadcrumbItem,
} from "../../navigation/breadcrumbs/breadcrumbs.component";

@Component({
  selector: "cog-desktop-shell",
  standalone: true,
  imports: [CognosBreadcrumbsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cog-desktop-shell">
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
        <header class="cog-desktop-shell__header">
          <div class="cog-desktop-shell__heading">
            <cog-breadcrumbs [items]="breadcrumbs()" />
            <h1 class="cog-desktop-shell__title">{{ title() }}</h1>
          </div>

          <div class="cog-desktop-shell__actions">
            <ng-content select="[cogDesktopActions]" />
          </div>
        </header>

        <main class="cog-desktop-shell__main">
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

      .cog-desktop-shell {
        display: grid;
        min-height: 100vh;
        grid-template-columns: 290px minmax(0, 1fr);
        background: var(--cog-app-bg);
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
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
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

      .cog-desktop-shell__main {
        padding: 0 var(--cog-space-300) var(--cog-space-300);
      }
    `,
  ],
})
export class CognosDesktopShellComponent {
  readonly breadcrumbs = input<CognosBreadcrumbItem[]>([]);
  readonly title = input("Workspace");
  readonly navFooter = input(false);

  protected readonly navClass = computed(() => {
    const classes = ["cog-desktop-shell__nav"];

    if (this.navFooter()) {
      classes.push("cog-desktop-shell__nav--footer");
    }

    return classes.join(" ");
  });
}
