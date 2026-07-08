import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import { CognosFileBadgeComponent } from '../../files/file-badge/file-badge.component';
import { CognosIconComponent } from '../../icon/icon.component';
import { CognosIconButtonComponent } from '../../primitives/icon-button/icon-button.component';
import type { CognosVaultFile } from '../vault.types';

@Component({
  selector: 'cog-vault-card',
  standalone: true,
  imports: [CognosFileBadgeComponent, CognosIconButtonComponent, CognosIconComponent],
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
          <span class="cog-vault-card__thumb"
            ><img class="cog-vault-card__thumb-image" [src]="file().img!" alt=""
          /></span>
        } @else {
          <cog-file-badge [ext]="file().ext" [size]="40" [radius]="4" />
        }

        @if (selectable()) {
          <span
            class="cog-vault-card__selection"
            [class.cog-vault-card__selection--selected]="selected()"
          >
            @if (selected()) {
              <cog-icon name="check" [size]="12" tone="current" />
            }
          </span>
        } @else {
          <cog-icon-button
            name="more-horizontal"
            [title]="moreLabel()"
            (click)="$event.stopPropagation(); more.emit(file())"
          />
        }
      </div>

      <div class="cog-vault-card__body">
        <div class="cog-vault-card__name">{{ file().name }}</div>
        <div class="cog-vault-card__details">{{ file().size }} · {{ file().meta }}</div>
      </div>

      <div class="cog-vault-card__footer">
        @if (refsLabel()) {
          @if (refsInteractive()) {
            <button
              type="button"
              class="cog-vault-card__refs cog-vault-card__refs--linked cog-vault-card__refs--button"
              (click)="$event.stopPropagation(); refsClick.emit()"
            >
              <cog-icon name="link" [size]="12" tone="link" />
              <span>{{ refsLabel() }}</span>
            </button>
          } @else {
            <span
              class="cog-vault-card__refs"
              [class.cog-vault-card__refs--linked]="file().refs > 0"
            >
              <cog-icon
                name="link"
                [size]="12"
                [tone]="file().refs > 0 ? 'link' : 'text-subtlest'"
              />
              <span>{{ refsLabel() }}</span>
            </span>
          }
        } @else {
          <span></span>
        }
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
        border: var(--cog-border-width) solid var(--cog-border);
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
          outline: var(--cog-border-width-strong) solid var(--cog-brand);
          outline-offset: var(--cog-border-width-strong);
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
        gap: var(--cog-space-100);
      }

      .cog-vault-card__thumb {
        overflow: hidden;
        width: 40px;
        height: 40px;
        border: var(--cog-border-width) solid var(--cog-border);
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
        border: var(--cog-border-width-strong) solid var(--cog-border-bold);
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
        font-size: var(--cog-fs-body);
        font-weight: var(--cog-fw-semibold);
        line-height: var(--cog-lh-body);
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .cog-vault-card__details {
        margin-top: 3px;
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);
      }

      .cog-vault-card__footer {
        align-items: center;
        border-top: var(--cog-border-width) solid var(--cog-border);
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
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);
      }

      .cog-vault-card__refs--linked {
        color: var(--cog-link);
      }

      /* Reset button chrome but keep the font from .cog-vault-card__refs — the
         font shorthand here would inherit the (larger) ambient size. */
      .cog-vault-card__refs--button {
        border: 0;
        background: none;
        padding: 0;
        font-family: inherit;
        font-weight: inherit;
        cursor: pointer;
      }

      .cog-vault-card__refs--button:hover span {
        text-decoration: underline;
      }

      .cog-vault-card__refs--button:focus-visible {
        outline: var(--cog-border-width-strong) solid var(--cog-brand);
        outline-offset: var(--cog-border-width-strong);
        border-radius: var(--cog-radius-xs);
      }
    `,
  ],
})
export class CognosVaultCardComponent {
  readonly file = input.required<CognosVaultFile>();
  readonly selectable = input(false);
  readonly selected = input(false);
  /** Accessible label for the "more" action; pass a translated string for i18n. */
  readonly moreLabel = input('More');
  /**
   * Footer reference text. `null` (default) renders the built-in English
   * "In N chats" / "Not referenced". Pass a translated string to override, or an
   * empty string to hide the reference line entirely (e.g. count not yet known).
   */
  readonly refsText = input<string | null>(null);
  /**
   * When true, the reference line renders as a button that emits `refsClick`
   * (e.g. to open the list of referencing chats). Only meaningful when there is
   * something to show — host gates this on a non-zero count.
   */
  readonly refsInteractive = input(false);
  readonly toggle = output<CognosVaultFile>();
  readonly open = output<CognosVaultFile>();
  readonly more = output<CognosVaultFile>();
  readonly refsClick = output<void>();

  protected readonly refsLabel = computed(() => {
    const custom = this.refsText();
    if (custom !== null) {
      return custom;
    }
    const refs = this.file().refs;
    return refs > 0 ? `In ${refs} chats` : 'Not referenced';
  });

  protected readonly interactive = computed(() => this.selectable() || !!this.file());
  protected readonly cardClass = computed(() => {
    const classes = ['cog-vault-card'];

    if (this.interactive()) {
      classes.push('cog-vault-card--interactive');
    }

    if (this.selected()) {
      classes.push('cog-vault-card--selected');
    }

    return classes.join(' ');
  });

  protected onCardClick(): void {
    if (this.selectable()) {
      this.toggle.emit(this.file());
      return;
    }

    this.open.emit(this.file());
  }
}
