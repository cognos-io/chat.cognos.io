import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from "@angular/core";

import { CognosIconComponent } from "../../icon/icon.component";
import { CognosToastService } from "../toast.service";

@Component({
  selector: "cog-toast-host",
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-toast-host">
      @for (toast of toastService.items(); track toast.id) {
        <div class="cog-toast" [class]="toastClass(toast.tone)">
          <span class="cog-toast__badge">
            <cog-icon [name]="toast.icon" [size]="15" [tone]="iconTone(toast.tone)" />
          </span>

          <div class="cog-toast__copy">
            <div class="cog-toast__title">{{ toast.title }}</div>
            @if (toast.msg) {
              <div class="cog-toast__msg">{{ toast.msg }}</div>
            }
            @if (toast.action) {
              <button class="cog-toast__action" type="button" (click)="toastService.runAction(toast)">
                {{ toast.action.label }}
              </button>
            }
          </div>

          <button class="cog-toast__dismiss" type="button" aria-label="Dismiss" title="Dismiss" (click)="toastService.dismiss(toast.id)">
            <cog-icon name="x" [size]="14" tone="text-subtlest" />
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset-inline: 0;
        inset-block-end: 26px;
        z-index: 400;
        pointer-events: none;
      }

      .cog-toast-host {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
      }

      .cog-toast {
        display: flex;
        min-width: 300px;
        max-width: 420px;
        align-items: flex-start;
        gap: 12px;
        pointer-events: auto;
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-md);
        background: var(--cog-surface);
        box-shadow: var(--cog-shadow-overlay);
        padding: 12px 12px 12px 14px;
        animation: cog-toast-enter 180ms var(--cog-ease-standard);
      }

      .cog-toast__badge {
        display: inline-flex;
        width: 28px;
        height: 28px;
        flex: none;
        align-items: center;
        justify-content: center;
        border-radius: var(--cog-radius-pill);
      }

      .cog-toast--success .cog-toast__badge {
        background: var(--cog-success-bg);
      }

      .cog-toast--info .cog-toast__badge {
        background: var(--cog-info-bg);
      }

      .cog-toast--danger .cog-toast__badge {
        background: var(--cog-loz-red-bg);
      }

      .cog-toast__copy {
        min-width: 0;
        flex: 1;
        padding-top: 1px;
      }

      .cog-toast__title {
        color: var(--cog-text);
        font-size: 13.5px;
        font-weight: var(--cog-fw-semibold);
        line-height: 1.4;
      }

      .cog-toast__msg {
        margin-top: 2px;
        color: var(--cog-text-subtle);
        font-size: 12.5px;
        line-height: 1.45;
      }

      .cog-toast__action {
        margin-top: 7px;
        border: 0;
        background: transparent;
        padding: 0;
        color: var(--cog-link);
        font-size: 12.5px;
        font-weight: var(--cog-fw-semibold);
        cursor: pointer;
      }

      .cog-toast__dismiss {
        display: inline-flex;
        width: 24px;
        height: 24px;
        flex: none;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: var(--cog-radius-xs);
        background: transparent;
        cursor: pointer;
      }

      @keyframes cog-toast-enter {
        from {
          opacity: 0;
          transform: translateY(8px);
        }

        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .cog-toast {
          animation: none;
        }
      }
    `,
  ],
})
export class CognosToastHostComponent {
  protected readonly toastService = inject(CognosToastService);

  protected toastClass(tone: "success" | "info" | "danger"): string {
    return `cog-toast cog-toast--${tone}`;
  }

  protected iconTone(tone: "success" | "info" | "danger"): "success" | "brand" | "danger" {
    switch (tone) {
      case "danger":
        return "danger";
      case "info":
        return "brand";
      default:
        return "success";
    }
  }
}
