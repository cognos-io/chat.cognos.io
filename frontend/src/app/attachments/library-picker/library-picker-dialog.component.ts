import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosIconComponent,
  CognosModalComponent,
  CognosSearchFieldComponent,
} from '@cognos/ui-angular';

import { DeviceService } from '@app/services/device.service';

import { AttachmentLibraryService, LibraryFile } from '../attachment-library.service';

/**
 * Library picker. Uses the standard `cog-modal` (centred dialog on desktop,
 * bottom sheet on mobile, matching the PII redaction modal) to list the user's
 * uploaded files, filter by name, and return the selected files so the composer
 * can re-attach them without re-uploading.
 */
@Component({
  selector: 'app-library-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CognosModalComponent,
    CognosButtonComponent,
    CognosIconComponent,
    CognosSearchFieldComponent,
    TranslocoModule,
  ],
  template: `
    <cog-modal
      *transloco="let t"
      [open]="open()"
      [width]="560"
      [stickyFooter]="true"
      [title]="t('library.picker.title')"
      (close)="cancel()"
    >
      <cog-search-field
        class="library-picker__search"
        [placeholder]="t('library.picker.searchPlaceholder')"
        [ariaLabel]="t('library.picker.searchPlaceholder')"
        [value]="query()"
        (valueChange)="query.set($event)"
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

      <div cogModalFooter class="library-picker__footer">
        <cog-button appearance="subtle" [fullWidth]="isMobile()" (click)="cancel()">{{
          t('library.picker.cancel')
        }}</cog-button>
        <cog-button
          appearance="primary"
          data-testid="library-attach-selected"
          [fullWidth]="isMobile()"
          [disabled]="selected().size === 0"
          (click)="attachSelectedFiles()"
          >{{
            t('library.picker.attachSelected', { count: selected().size })
          }}</cog-button
        >
      </div>
    </cog-modal>
  `,
  styles: [
    `
      .library-picker__search {
        display: block;
        margin-bottom: var(--cog-space-100);
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
        gap: var(--cog-space-100);
        padding: var(--cog-space-100);
        border-radius: var(--cog-radius-sm);
        cursor: pointer;
      }
      .library-picker__row:hover {
        background: var(--cog-surface-hover);
      }
      .library-picker__name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .library-picker__size {
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body-sm);
      }
      .library-picker__empty {
        color: var(--cog-text-subtle);
        margin: var(--cog-space-200) 0;
        text-align: center;
      }
      /* Desktop: right-aligned actions. */
      .library-picker__footer {
        display: flex;
        width: 100%;
        justify-content: flex-end;
        gap: var(--cog-space-100);
      }
      /* Mobile sheet: full-width buttons, two side-by-side at 50% each. */
      @media (max-width: 600px) {
        .library-picker__footer {
          display: grid;
          grid-template-columns: 1fr 1fr;
        }
      }
    `,
  ],
})
export class LibraryPickerComponent {
  private readonly _library = inject(AttachmentLibraryService);
  private readonly _device = inject(DeviceService);

  /** Whether the picker is shown. The host drives this. */
  readonly open = input(false);
  /** Emits the chosen files when the user confirms. */
  readonly attachSelected = output<LibraryFile[]>();
  /** Emits when the picker should close (cancel or after a successful attach). */
  readonly closed = output<void>();

  readonly isMobile = this._device.isMobile;
  readonly query = signal('');
  readonly selected = signal<Set<string>>(new Set());

  readonly files = this._library.files;
  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const files = this.files();
    return q ? files.filter((f) => f.displayName.toLowerCase().includes(q)) : files;
  });

  // Refresh the library and reset selection each time the picker opens.
  private readonly _onOpen = effect(() => {
    if (this.open()) {
      this.query.set('');
      this.selected.set(new Set());
      this._library.refresh().subscribe({ error: () => undefined });
    }
  });

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

  attachSelectedFiles(): void {
    const chosen = this.files().filter((f) => this.selected().has(f.id));
    if (chosen.length > 0) {
      this.attachSelected.emit(chosen);
    }
    this.closed.emit();
  }

  cancel(): void {
    this.closed.emit();
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
