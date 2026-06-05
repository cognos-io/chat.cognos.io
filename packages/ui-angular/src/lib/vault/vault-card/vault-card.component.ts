import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from "@angular/core";

import { CognosIconButtonComponent } from "../../primitives/icon-button/icon-button.component";
import { CognosIconComponent } from "../../icon/icon.component";
import { CognosFileBadgeComponent } from "../../files/file-badge/file-badge.component";
import type { CognosVaultFile } from "../vault.types";

@Component({
  selector: "cog-vault-card",
  standalone: true,
  imports: [
    CognosFileBadgeComponent,
    CognosIconButtonComponent,
    CognosIconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="cog-vault-card"
      [class]="cardClass()"
      [attr.role]="interactive() ? 'button' : null"
      [attr.tabindex]="interactive() ? 0 : null"
      (click)="onCardClick()"
      (keydown.enter)="onCardClick()"
      (keydown.space)="$event.preventDefault(); onCardClick()"
    >
      <div class="cog-vault-card__header">
        @if (file().kind === 'image' && file().img) {
          <span class="cog-vault-card__thumb"><img class="cog-vault-card__thumb-image" [src]="file().img!" alt="" /></span>
        } @else {
          <cog-file-badge [ext]="file().ext" [size]="40" [radius]="4" />
        }

        @if (selectable()) {
          <span class="cog-vault-card__selection" [class.cog-vault-card__selection--selected]="selected()">
            @if (selected()) {
              <cog-icon name="check" [size]="12" tone="current" />
            }
          </span>
        } @else {
          <cog-icon-button name="more-horizontal" title="More" (click)="$event.stopPropagation(); more.emit(file())" />
        }
      </div>

      <div class="cog-vault-card__body">
        <div class="cog-vault-card__name">{{ file().name }}</div>
        <div class="cog-vault-card__details">{{ file().size }} · {{ file().meta }}</div>
      </div>

      <div class="cog-vault-card__footer">
        <span class="cog-vault-card__refs" [class.cog-vault-card__refs--linked]="file().refs > 0">
          <cog-icon name="link" [size]="12" [tone]="file().refs > 0 ? 'link' : 'text-subtlest'" />
          <span>{{ file().refs > 0 ? 'In ' + file().refs + ' chats' : 'Not referenced' }}</span>
        </span>
        <cog-icon name="lock" [size]="12" tone="success" />
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-vault-card {
        display: flex;
        min-height: 124px;
        flex-direction: column;
        gap: 11px;
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-md);
        background: var(--cog-surface);
        padding: 13px;
        transition:
          border-color var(--cog-dur-fast) var(--cog-ease-standard),
          box-shadow var(--cog-dur-fast) var(--cog-ease-standard);

        &.cog-vault-card--interactive {
          cursor: pointer;
        }

        &.cog-vault-card--interactive:hover {
          border-color: var(--cog-border-bold);
          box-shadow: var(--cog-shadow-raised);
        }

        &.cog-vault-card--interactive:focus-visible {
          outline: 2px solid var(--cog-brand);
          outline-offset: 2px;
        }

        &.cog-vault-card--selected {
          border-color: var(--cog-selected-border);
          background: var(--cog-selected-bg);
        }
      }

      .cog-vault-card__header,
      .cog-vault-card__footer {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }

      .cog-vault-card__thumb {
        overflow: hidden;
        width: 40px;
        height: 40px;
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
      }

      .cog-vault-card__thumb-image {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .cog-vault-card__selection {
        display: inline-flex;
        width: 20px;
        height: 20px;
        flex: none;
        align-items: center;
        justify-content: center;
        border: 2px solid var(--cog-border-bold);
        border-radius: var(--cog-radius-pill);
        color: var(--cog-on-brand);
      }

      .cog-vault-card__selection--selected {
        border-color: var(--cog-brand);
        background: var(--cog-brand);
      }

      .cog-vault-card__body {
        min-width: 0;
        flex: 1;
      }

      .cog-vault-card__name {
        display: -webkit-box;
        overflow: hidden;
        color: var(--cog-text);
        font-size: 13.5px;
        font-weight: var(--cog-fw-semibold);
        line-height: 1.35;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .cog-vault-card__details {
        margin-top: 3px;
        color: var(--cog-text-subtlest);
        font-size: 12px;
        line-height: 1.4;
      }

      .cog-vault-card__footer {
        align-items: center;
        border-top: 1px solid var(--cog-border);
        padding-top: 9px;
      }

      .cog-vault-card--selected .cog-vault-card__footer {
        border-top-color: transparent;
      }

      .cog-vault-card__refs {
        display: inline-flex;
        min-width: 0;
        align-items: center;
        gap: 5px;
        color: var(--cog-text-subtlest);
        font-size: 11.5px;
        line-height: 1.4;
      }

      .cog-vault-card__refs--linked {
        color: var(--cog-link);
      }
    `,
  ],
})
export class CognosVaultCardComponent {
  readonly file = input.required<CognosVaultFile>();
  readonly selectable = input(false);
  readonly selected = input(false);
  readonly toggle = output<CognosVaultFile>();
  readonly open = output<CognosVaultFile>();
  readonly more = output<CognosVaultFile>();

  protected readonly interactive = computed(
    () => this.selectable() || !!this.file(),
  );
  protected readonly cardClass = computed(() => {
    const classes = ["cog-vault-card"];

    if (this.interactive()) {
      classes.push("cog-vault-card--interactive");
    }

    if (this.selected()) {
      classes.push("cog-vault-card--selected");
    }

    return classes.join(" ");
  });

  protected onCardClick(): void {
    if (this.selectable()) {
      this.toggle.emit(this.file());
      return;
    }

    this.open.emit(this.file());
  }
}
