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
  selector: 'cog-vault-list-row',
  standalone: true,
  imports: [CognosFileBadgeComponent, CognosIconButtonComponent, CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="cog-vault-list-row"
      [class.cog-vault-list-row--top]="top()"
      role="button"
      tabindex="0"
      (click)="open.emit(file())"
      (keydown.enter)="open.emit(file())"
      (keydown.space)="$event.preventDefault(); open.emit(file())"
    >
      @if (file().kind === 'image' && file().img) {
        <span class="cog-vault-list-row__thumb"
          ><img class="cog-vault-list-row__thumb-image" [src]="file().img!" alt=""
        /></span>
      } @else {
        <cog-file-badge [ext]="file().ext" [size]="34" [radius]="4" />
      }

      <div class="cog-vault-list-row__copy">
        <div class="cog-vault-list-row__name">{{ file().name }}</div>
        <div class="cog-vault-list-row__details">
          {{ file().size }} · {{ file().meta }} · {{ file().when }}
        </div>
      </div>

      @if (refsLabel()) {
        <span
          class="cog-vault-list-row__refs"
          [class.cog-vault-list-row__refs--linked]="file().refs > 0"
        >
          <cog-icon
            name="link"
            [size]="12"
            [tone]="file().refs > 0 ? 'link' : 'text-subtlest'"
          />
          <span>{{ refsLabel() }}</span>
        </span>
      }
      <cog-icon name="lock" [size]="13" tone="success" />
      <cog-icon-button
        name="more-horizontal"
        [title]="moreLabel()"
        (click)="$event.stopPropagation(); more.emit(file())"
      />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-vault-list-row {
        display: flex;
        align-items: center;
        gap: 13px;
        padding: 11px 13px;
        cursor: pointer;

        &:hover {
          background: var(--cog-surface-hover);
        }

        &:focus-visible {
          outline: 2px solid var(--cog-brand);
          outline-offset: -2px;
        }
      }

      .cog-vault-list-row--top {
        border-top: 1px solid var(--cog-border);
      }

      .cog-vault-list-row__thumb {
        overflow: hidden;
        width: 34px;
        height: 34px;
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
      }

      .cog-vault-list-row__thumb-image {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .cog-vault-list-row__copy {
        min-width: 0;
        flex: 1;
      }

      .cog-vault-list-row__name {
        overflow: hidden;
        color: var(--cog-text);
        font-size: 13.5px;
        font-weight: var(--cog-fw-medium);
        line-height: 1.4;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cog-vault-list-row__details {
        margin-top: 1px;
        overflow: hidden;
        color: var(--cog-text-subtlest);
        font-size: 12px;
        line-height: 1.4;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cog-vault-list-row__refs {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: var(--cog-text-subtlest);
        font-size: 11.5px;
        line-height: 1.4;
        white-space: nowrap;
      }

      .cog-vault-list-row__refs--linked {
        color: var(--cog-link);
      }
    `,
  ],
})
export class CognosVaultListRowComponent {
  readonly file = input.required<CognosVaultFile>();
  readonly top = input(false);
  /** Accessible label for the "more" action; pass a translated string for i18n. */
  readonly moreLabel = input('More');
  /**
   * Reference text. `null` (default) renders the built-in English "N chats" / "—".
   * Pass a translated string to override, or an empty string to hide it (e.g.
   * count not yet known).
   */
  readonly refsText = input<string | null>(null);
  readonly open = output<CognosVaultFile>();
  readonly more = output<CognosVaultFile>();

  protected readonly refsLabel = computed(() => {
    const custom = this.refsText();
    if (custom !== null) {
      return custom;
    }
    const refs = this.file().refs;
    return refs > 0 ? `${refs} chats` : '—';
  });
}
