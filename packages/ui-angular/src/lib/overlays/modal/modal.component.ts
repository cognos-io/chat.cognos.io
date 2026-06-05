import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from "@angular/core";
import type { CognosIconName } from "@cognos/ui/icons";

import { CognosIconComponent } from "../../icon/icon.component";
import { CognosIconButtonComponent } from "../../primitives/icon-button/icon-button.component";

export type CognosModalTitleTone = "default" | "info" | "success" | "danger";

@Component({
  selector: "cog-modal",
  standalone: true,
  imports: [CognosIconButtonComponent, CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="cog-modal">
        <button
          aria-hidden="true"
          class="cog-modal__scrim"
          type="button"
          (click)="onClose()"
        ></button>

        <section
          [class]="modalClass()"
          [style.--cog-modal-width]="width() + 'px'"
          aria-modal="true"
          role="dialog"
        >
          <header class="cog-modal__header">
            <div class="cog-modal__header-content">
              <div class="cog-modal__title-wrap">
                @if (titleIcon()) {
                  <span [class]="titleIconClass()">
                    <cog-icon
                      [name]="titleIcon()!"
                      [size]="18"
                      [tone]="titleIconTone()"
                    />
                  </span>
                }

                <h2 class="cog-modal__title">{{ title() }}</h2>
              </div>
            </div>

            <cog-icon-button name="x" title="Close" (click)="onClose()" />
          </header>

          <div class="cog-modal__body">
            <ng-content />
          </div>

          @if (stickyFooter()) {
            <footer class="cog-modal__footer">
              <ng-content select="[cogModalFooter]" />
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

      .cog-modal {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: grid;
        place-items: center;
        padding: var(--cog-space-300);
      }

      .cog-modal__scrim {
        position: absolute;
        inset: 0;
        border: 0;
        background: var(--cog-scrim);
      }

      .cog-modal__panel {
        position: relative;
        z-index: 1;
        display: grid;
        width: min(100%, var(--cog-modal-width));
        grid-template-rows: auto minmax(0, 1fr);
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-md);
        background: var(--cog-surface);
        box-shadow: var(--cog-shadow-overlay);
      }

      .cog-modal__panel--footer {
        grid-template-rows: auto minmax(0, 1fr) auto;
      }

      .cog-modal__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cog-space-150);
        padding: var(--cog-space-200) var(--cog-space-200) var(--cog-space-150);
      }

      .cog-modal__header-content {
        min-width: 0;
        flex: 1;
      }

      .cog-modal__title-wrap {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: var(--cog-space-150);
      }

      .cog-modal__title-icon {
        display: inline-flex;
        width: 36px;
        height: 36px;
        flex: none;
        align-items: center;
        justify-content: center;
        border-radius: var(--cog-radius-pill);

        &.cog-modal__title-icon--default {
          background: var(--cog-selected-bg);
        }

        &.cog-modal__title-icon--info {
          background: var(--cog-info-bg);
        }

        &.cog-modal__title-icon--success {
          background: var(--cog-success-bg);
        }

        &.cog-modal__title-icon--danger {
          background: var(--cog-loz-red-bg);
        }
      }

      .cog-modal__title {
        margin: 0;
        color: var(--cog-text);
        font-size: var(--cog-fs-h-md);
        font-weight: var(--cog-fw-h-md);
        line-height: var(--cog-lh-h-md);
      }

      .cog-modal__body {
        padding: 0 var(--cog-space-200) var(--cog-space-200);
      }

      .cog-modal__footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--cog-space-100);
        border-top: 1px solid var(--cog-border);
        padding: var(--cog-space-150) var(--cog-space-200);
      }

      @media (max-width: 600px) {
        .cog-modal {
          align-items: end;
          padding: 0;
        }

        .cog-modal__panel {
          width: 100%;
          max-height: 94%;
          border-right: 0;
          border-bottom: 0;
          border-left: 0;
          border-radius: var(--cog-radius-lg) var(--cog-radius-lg) 0 0;
        }
      }
    `,
  ],
})
export class CognosModalComponent {
  readonly open = input(false);
  readonly title = input("");
  readonly titleIcon = input<CognosIconName | null>(null);
  readonly titleTone = input<CognosModalTitleTone>("default");
  readonly width = input(540);
  readonly stickyFooter = input(false);
  readonly close = output<void>();

  protected readonly modalClass = computed(() => {
    const classes = ["cog-modal__panel"];

    if (this.stickyFooter()) {
      classes.push("cog-modal__panel--footer");
    }

    return classes.join(" ");
  });

  protected readonly titleIconClass = computed(
    () => `cog-modal__title-icon cog-modal__title-icon--${this.titleTone()}`,
  );

  protected readonly titleIconTone = computed(() => {
    switch (this.titleTone()) {
      case "danger":
        return "danger" as const;
      case "info":
        return "brand" as const;
      case "success":
        return "success" as const;
      default:
        return "selected" as const;
    }
  });

  protected onClose(): void {
    this.close.emit();
  }
}
