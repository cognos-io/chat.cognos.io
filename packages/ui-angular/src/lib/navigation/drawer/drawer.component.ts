import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import { CognosIconButtonComponent } from '../../primitives/icon-button/icon-button.component';

@Component({
  selector: 'cog-drawer',
  standalone: true,
  imports: [CognosIconButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="cog-drawer">
        <button
          aria-hidden="true"
          class="cog-drawer__scrim"
          type="button"
          (click)="onClose()"
        ></button>

        <aside
          [class]="drawerClass()"
          [attr.aria-label]="title() || null"
          aria-modal="true"
          role="dialog"
        >
          <header class="cog-drawer__header">
            <ng-content select="[cogDrawerHeader]" />
            @if (title() && !hideTitle()) {
              <h2 class="cog-drawer__title">{{ title() }}</h2>
            }
            <cog-icon-button name="x" size="lg" title="Close" (click)="onClose()" />
          </header>

          <div class="cog-drawer__body">
            <ng-content />
          </div>

          @if (stickyFooter()) {
            <footer class="cog-drawer__footer">
              <ng-content select="[cogDrawerFooter]" />
            </footer>
          }
        </aside>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      .cog-drawer {
        position: fixed;
        inset: 0;
        z-index: 45;
      }

      .cog-drawer__scrim {
        position: absolute;
        inset: 0;
        border: 0;
        background: var(--cog-scrim);
      }

      .cog-drawer__panel {
        position: relative;
        display: grid;
        width: min(86vw, 320px);
        height: 100%;
        grid-template-rows: auto minmax(0, 1fr);
        border-right: 1px solid var(--cog-border);
        background: var(--cog-nav-bg);
        box-shadow: var(--cog-shadow-overlay);
        animation: cog-drawer-enter var(--cog-dur-sheet) var(--cog-ease-standard);
      }

      .cog-drawer__panel--footer {
        grid-template-rows: auto minmax(0, 1fr) auto;
      }

      .cog-drawer__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cog-space-150);
        padding: var(--cog-space-150);
      }

      .cog-drawer__title {
        margin: 0;
        color: var(--cog-text);
        font-size: var(--cog-fs-h-sm);
        font-weight: var(--cog-fw-h-sm);
        line-height: var(--cog-lh-h-sm);
      }

      .cog-drawer__body {
        overflow: auto;
        padding: 0 var(--cog-space-100) var(--cog-space-200);
      }

      .cog-drawer__footer {
        border-top: 1px solid var(--cog-border);
        background: var(--cog-nav-bg);
        padding: var(--cog-space-150) var(--cog-space-100)
          calc(var(--cog-space-150) + env(safe-area-inset-bottom));
      }

      @keyframes cog-drawer-enter {
        from {
          transform: translateX(-20px);
          opacity: 0;
        }

        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    `,
  ],
})
export class CognosDrawerComponent {
  readonly open = input(false);
  readonly title = input('Navigation');
  readonly hideTitle = input(false);
  readonly stickyFooter = input(false);
  readonly close = output<void>();

  protected readonly drawerClass = computed(() => {
    const classes = ['cog-drawer__panel'];

    if (this.stickyFooter()) {
      classes.push('cog-drawer__panel--footer');
    }

    return classes.join(' ');
  });

  protected onClose(): void {
    this.close.emit();
  }
}
