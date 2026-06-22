import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import { CognosIconButtonComponent } from '../../primitives/icon-button/icon-button.component';

@Component({
  selector: 'cog-dialog-surface',
  standalone: true,
  imports: [CognosIconButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section [class]="surfaceClass()" [style.--cog-dialog-surface-width]="widthVar()">
      <header class="cog-dialog-surface__header">
        <div class="cog-dialog-surface__heading">
          <h2 class="cog-dialog-surface__title">{{ title() }}</h2>
          @if (subtitle()) {
            <p class="cog-dialog-surface__subtitle">{{ subtitle() }}</p>
          }
        </div>

        <!-- Optional controls aligned with the title (e.g. a language picker).
             Projects nothing when unused, so other dialogs are unaffected. -->
        <ng-content select="[cogDialogHeaderActions]" />

        @if (dismissible()) {
          <cog-icon-button name="x" title="Close" size="lg" (click)="onClose()" />
        }
      </header>

      <div class="cog-dialog-surface__body">
        <ng-content />
      </div>

      @if (footer()) {
        <footer class="cog-dialog-surface__footer">
          <ng-content select="[cogDialogFooter]" />
        </footer>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-dialog-surface {
        display: grid;
        width: var(--cog-dialog-surface-width, auto);
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-md);
        background: var(--cog-surface);
        box-shadow: var(--cog-shadow-overlay);
      }

      .cog-dialog-surface--footer {
        grid-template-rows: auto minmax(0, 1fr) auto;
      }

      .cog-dialog-surface__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cog-space-150);
        padding: var(--cog-space-200) var(--cog-space-200) var(--cog-space-150);
      }

      .cog-dialog-surface__heading {
        display: grid;
        gap: var(--cog-space-050);
        min-width: 0;
        flex: 1;
      }

      .cog-dialog-surface__title {
        margin: 0;
        color: var(--cog-text);
        font-size: var(--cog-fs-h-md);
        font-weight: var(--cog-fw-h-md);
        line-height: var(--cog-lh-h-md);
      }

      .cog-dialog-surface__subtitle {
        margin: 0;
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);
      }

      .cog-dialog-surface__body {
        padding: 0 var(--cog-space-200) var(--cog-space-200);
      }

      .cog-dialog-surface__footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--cog-space-100);
        border-top: 1px solid var(--cog-border);
        padding: var(--cog-space-150) var(--cog-space-200);
      }
    `,
  ],
})
export class CognosDialogSurfaceComponent {
  readonly title = input('');
  readonly subtitle = input('');
  readonly footer = input(false);
  readonly dismissible = input(true);
  /**
   * Optional fixed width in px. When unset the surface shrinks to fit its
   * content (capped by the dialog panel). When set it matches the panel's
   * responsive clamp so it never overflows narrow viewports.
   */
  readonly width = input<number | null>(null);
  readonly close = output<void>();

  protected readonly surfaceClass = computed(() => {
    const classes = ['cog-dialog-surface'];

    if (this.footer()) {
      classes.push('cog-dialog-surface--footer');
    }

    return classes.join(' ');
  });

  protected readonly widthVar = computed(() => {
    const width = this.width();

    return width == null ? null : `min(${width}px, calc(100vw - 32px))`;
  });

  protected onClose(): void {
    this.close.emit();
  }
}
