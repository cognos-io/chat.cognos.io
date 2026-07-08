import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { CognosButtonComponent } from '../../button/button.component';
import { CognosIconComponent } from '../../icon/icon.component';

/**
 * A single bookmark row: the saved highlight (`quote`), an optional user `note`,
 * and the `id` echoed back on jump/remove. The quote/note are already-decrypted
 * plain strings — this component never touches ciphertext.
 */
export interface BookmarkListItem {
  id: string;
  quote: string;
  note?: string;
}

/** Localised copy for the list; supplied by the host so the library stays translation-free. */
export interface BookmarkListLabels {
  empty: string;
  jump: string;
  remove: string;
}

/**
 * Presentational list of saved bookmarks for the settings page: each row shows
 * the highlighted quote (and note, when present) with Jump / Remove actions.
 * Renders a muted empty state when there are none. Purely label-driven — the
 * host wires the outputs to navigation and removal.
 */
@Component({
  selector: 'cog-bookmark-list',
  standalone: true,
  imports: [CognosButtonComponent, CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (bookmarks().length === 0) {
      <p class="cog-bookmark-list__empty" role="status">
        <cog-icon name="pin" [size]="16" tone="current" />
        {{ labels().empty }}
      </p>
    } @else {
      <ul class="cog-bookmark-list">
        @for (bookmark of bookmarks(); track bookmark.id) {
          <li class="cog-bookmark-list__item">
            <div class="cog-bookmark-list__text">
              <blockquote class="cog-bookmark-list__quote">
                {{ bookmark.quote }}
              </blockquote>
              @if (bookmark.note) {
                <p class="cog-bookmark-list__note">{{ bookmark.note }}</p>
              }
            </div>
            <div class="cog-bookmark-list__actions">
              <cog-button
                appearance="default"
                icon="chevron-right"
                (click)="jump.emit(bookmark.id)"
              >
                {{ labels().jump }}
              </cog-button>
              <cog-button
                appearance="danger"
                icon="eraser"
                (click)="remove.emit(bookmark.id)"
              >
                {{ labels().remove }}
              </cog-button>
            </div>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .cog-bookmark-list__empty {
      display: flex;
      align-items: center;
      gap: var(--cog-space-050);
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
    }

    .cog-bookmark-list {
      display: grid;
      gap: var(--cog-space-150);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .cog-bookmark-list__item {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--cog-space-150);
      flex-wrap: wrap;
      padding-bottom: var(--cog-space-150);
      border-bottom: var(--cog-border-width) solid var(--cog-border);
    }

    .cog-bookmark-list__item:last-child {
      padding-bottom: 0;
      border-bottom: 0;
    }

    .cog-bookmark-list__text {
      flex: 1;
      min-width: 0;
    }

    .cog-bookmark-list__quote {
      margin: 0;
      padding-left: var(--cog-space-150);
      border-left: var(--cog-border-width-strong) solid var(--cog-warning-bg);
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }

    .cog-bookmark-list__note {
      margin: var(--cog-space-050) 0 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
    }

    .cog-bookmark-list__actions {
      display: flex;
      gap: var(--cog-space-100);
      align-items: center;
      flex-wrap: wrap;
    }
  `,
})
export class CognosBookmarkListComponent {
  readonly bookmarks = input<BookmarkListItem[]>([]);
  readonly labels = input<BookmarkListLabels>({
    empty: 'No bookmarks yet.',
    jump: 'Jump',
    remove: 'Remove',
  });

  /** Emits the id of the bookmark to jump to. */
  readonly jump = output<string>();
  /** Emits the id of the bookmark to remove. */
  readonly remove = output<string>();
}
