import { DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosDialogSurfaceComponent,
  CognosIconComponent,
} from '@cognos/ui-angular';

import { AttachmentLibraryService, LibraryFile } from '../attachment-library.service';

/**
 * Library picker: lists the user's uploaded files, filters by name, and returns
 * the selected files so the composer can re-attach them without re-uploading.
 * Closes with the chosen LibraryFile[] (or undefined on cancel).
 */
@Component({
  selector: 'app-library-picker-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CognosDialogSurfaceComponent,
    CognosButtonComponent,
    CognosIconComponent,
    TranslocoModule,
  ],
  template: `
    <cog-dialog-surface
      *transloco="let t"
      [title]="t('library.picker.title')"
      [footer]="true"
      (close)="cancel()"
    >
      <input
        type="search"
        class="library-picker__search"
        data-testid="library-search"
        [attr.placeholder]="t('library.picker.searchPlaceholder')"
        [attr.aria-label]="t('library.picker.searchPlaceholder')"
        (input)="query.set($any($event.target).value)"
      />

      @if (filtered().length === 0) {
        <p class="library-picker__empty">{{ t('library.picker.empty') }}</p>
      } @else {
        <ul class="library-picker__list" data-testid="library-list">
          @for (file of filtered(); track file.id) {
            <li class="library-picker__item">
              <label class="library-picker__row">
                <input
                  type="checkbox"
                  [attr.data-testid]="'library-item-' + file.id"
                  [checked]="selected().has(file.id)"
                  (change)="toggle(file.id)"
                />
                <cog-icon name="file-text" [size]="18" tone="text-subtle" />
                <span class="library-picker__name" [title]="file.displayName">{{
                  file.displayName
                }}</span>
                <span class="library-picker__size">{{
                  formatSize(file.sizeBytes)
                }}</span>
              </label>
            </li>
          }
        </ul>
      }

      <div cogDialogFooter>
        <cog-button appearance="subtle" (click)="cancel()">{{
          t('library.picker.cancel')
        }}</cog-button>
        <cog-button
          appearance="primary"
          data-testid="library-attach-selected"
          [disabled]="selected().size === 0"
          (click)="attach()"
          >{{
            t('library.picker.attachSelected', { count: selected().size })
          }}</cog-button
        >
      </div>
    </cog-dialog-surface>
  `,
  styles: [
    `
      .library-picker__search {
        width: 100%;
        padding: 0.5rem 0.75rem;
        margin-bottom: 0.75rem;
        border: 1px solid var(--cog-color-border, rgba(0, 0, 0, 0.1));
        border-radius: 0.5rem;
        font: inherit;
      }
      .library-picker__list {
        list-style: none;
        margin: 0;
        padding: 0;
        max-height: 50vh;
        overflow-y: auto;
      }
      .library-picker__row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem;
        border-radius: 0.5rem;
        cursor: pointer;
      }
      .library-picker__row:hover {
        background: var(--cog-color-surface-hover, rgba(0, 0, 0, 0.05));
      }
      .library-picker__name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .library-picker__size {
        color: var(--cog-color-text-subtle, rgba(0, 0, 0, 0.55));
        font-size: 0.8125rem;
      }
      .library-picker__empty {
        color: var(--cog-color-text-subtle, rgba(0, 0, 0, 0.55));
        margin: 1rem 0;
        text-align: center;
      }
    `,
  ],
})
export class LibraryPickerDialogComponent implements OnInit {
  private readonly _dialogRef = inject(DialogRef<LibraryFile[]>);
  private readonly _library = inject(AttachmentLibraryService);

  readonly query = signal('');
  readonly selected = signal<Set<string>>(new Set());

  readonly files = this._library.files;
  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const files = this.files();
    if (!q) {
      return files;
    }
    return files.filter((f) => f.displayName.toLowerCase().includes(q));
  });

  ngOnInit(): void {
    this._library.refresh().subscribe({ error: () => undefined });
  }

  toggle(id: string): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  attach(): void {
    const chosen = this.files().filter((f) => this.selected().has(f.id));
    this._dialogRef.close(chosen);
  }

  cancel(): void {
    this._dialogRef.close(undefined);
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
