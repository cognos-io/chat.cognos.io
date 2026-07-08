import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import { CognosIconButtonComponent } from '../../primitives/icon-button/icon-button.component';

@Component({
  selector: 'cog-sheet',
  standalone: true,
  imports: [CognosIconButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="cog-sheet">
        <button
          aria-hidden="true"
          class="cog-sheet__scrim"
          type="button"
          (click)="onClose()"
        ></button>

        <section [class]="sheetClass()" aria-modal="true" role="dialog">
          <div class="cog-sheet__handle"></div>

          @if (title() || full()) {
            <header class="cog-sheet__header">
              <h2 class="cog-sheet__title">{{ title() }}</h2>
              <cog-icon-button name="x" size="lg" title="Close" (click)="onClose()" />
            </header>
          }

          <div class="cog-sheet__body">
            <ng-content />
          </div>

          @if (stickyFooter()) {
            <footer class="cog-sheet__footer">
              <ng-content select="[cogSheetFooter]" />
            </footer>
          }
        </section>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      .cog-sheet {
        position: fixed;
        inset: 0;
        z-index: 40;
      }

      .cog-sheet__scrim {
        position: absolute;
        inset: 0;
        border: 0;
        background: var(--cog-scrim);
      }

      .cog-sheet__panel {
        position: absolute;
        right: 0;
        bottom: 0;
        left: 0;
        display: grid;
        max-height: 78%;
        grid-template-rows: auto auto minmax(0, 1fr);
        border-radius: var(--cog-radius-lg) var(--cog-radius-lg) 0 0;
        background: var(--cog-surface);
        box-shadow: var(--cog-shadow-overlay);
        animation: cog-sheet-enter var(--cog-dur-sheet) var(--cog-ease-standard);
      }

      .cog-sheet__panel--full {
        max-height: 94%;
      }

      .cog-sheet__panel--footer {
        grid-template-rows: auto auto minmax(0, 1fr) auto;
      }

      .cog-sheet__handle {
        width: 36px;
        height: 4px;
        margin: var(--cog-space-100) auto var(--cog-space-150);
        border-radius: var(--cog-radius-pill);
        background: var(--cog-border);
      }

      .cog-sheet__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cog-space-150);
        padding: 0 var(--cog-space-200) var(--cog-space-150);
      }

      .cog-sheet__title {
        margin: 0;
        color: var(--cog-text);
        font-size: var(--cog-fs-h-md);
        font-weight: var(--cog-fw-h-md);
        line-height: var(--cog-lh-h-md);
      }

      .cog-sheet__body {
        overflow: auto;
        padding: 0 var(--cog-space-200) var(--cog-space-200);
      }

      .cog-sheet__footer {
        border-top: var(--cog-border-width) solid var(--cog-border);
        background: var(--cog-surface);
        padding: var(--cog-space-150) var(--cog-space-200)
          calc(var(--cog-space-150) + env(safe-area-inset-bottom));
      }

      @keyframes cog-sheet-enter {
        from {
          transform: translateY(20px);
          opacity: 0;
        }

        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
    `,
  ],
})
export class CognosSheetComponent {
  readonly open = input(false);
  readonly title = input('');
  readonly full = input(false);
  readonly stickyFooter = input(false);
  readonly close = output<void>();

  protected readonly sheetClass = computed(() => {
    const classes = ['cog-sheet__panel'];

    if (this.full()) {
      classes.push('cog-sheet__panel--full');
    }

    if (this.stickyFooter()) {
      classes.push('cog-sheet__panel--footer');
    }

    return classes.join(' ');
  });

  protected onClose(): void {
    this.close.emit();
  }
}
