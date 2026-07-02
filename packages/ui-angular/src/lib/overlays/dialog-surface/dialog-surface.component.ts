import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import type { CognosIconName } from '@cognos/ui/icons';

import { CognosIconComponent } from '../../icon/icon.component';
import { CognosIconButtonComponent } from '../../primitives/icon-button/icon-button.component';

export type CognosDialogSurfaceIconTone = 'default' | 'info' | 'success' | 'danger';

@Component({
  selector: 'cog-dialog-surface',
  standalone: true,
  imports: [CognosIconButtonComponent, CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section [class]="surfaceClass()" [style.--_surface-width]="widthVar()">
      <header class="cog-dialog-surface__header">
        @if (icon()) {
          <span [class]="iconClass()">
            <cog-icon [name]="icon()!" [size]="18" [tone]="resolvedIconTone()" />
          </span>
        }

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
          <cog-icon-button
            name="x"
            [title]="closeLabel()"
            size="lg"
            (click)="onClose()"
          />
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
        width: var(--_surface-width, auto);
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

      .cog-dialog-surface__icon {
        display: inline-flex;
        width: 36px;
        height: 36px;
        flex: none;
        align-items: center;
        justify-content: center;
        border-radius: var(--cog-radius-pill);
      }

      .cog-dialog-surface__icon--default {
        background: var(--cog-selected-bg);
      }

      .cog-dialog-surface__icon--info {
        background: var(--cog-info-bg);
      }

      .cog-dialog-surface__icon--success {
        background: var(--cog-success-bg);
      }

      .cog-dialog-surface__icon--danger {
        background: var(--cog-loz-red-bg);
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
   * Accessible label / tooltip for the close button. Defaults to the English
   * "Close"; apps should pass their translated `common.close` so the shared lib
   * stays app-agnostic while remaining localised in-app.
   */
  readonly closeLabel = input('Close');
  /**
   * Optional leading icon rendered in a tinted chip beside the title, matching
   * `cog-modal`. Unset (default) renders no chip so existing dialogs are
   * unaffected.
   */
  readonly icon = input<CognosIconName | null>(null);
  readonly iconTone = input<CognosDialogSurfaceIconTone>('default');
  /**
   * Optional fixed width in px. When unset the surface shrinks to fit its
   * content (capped by the dialog panel). When set it matches the panel's
   * responsive clamp so it never overflows narrow viewports.
   */
  readonly width = input<number | null>(null);
  readonly close = output<void>();

  protected readonly iconClass = computed(
    () => `cog-dialog-surface__icon cog-dialog-surface__icon--${this.iconTone()}`,
  );

  protected readonly resolvedIconTone = computed(() => {
    switch (this.iconTone()) {
      case 'danger':
        return 'danger' as const;
      case 'info':
        return 'brand' as const;
      case 'success':
        return 'success' as const;
      default:
        return 'selected' as const;
    }
  });

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
