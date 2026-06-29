import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import { firstValueFrom } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosEmptyStateComponent,
  type CognosFilterChipOption,
  CognosFilterChipsComponent,
  CognosIconButtonComponent,
  CognosModalComponent,
  CognosSearchFieldComponent,
  CognosToastService,
  CognosVaultCardComponent,
  type CognosVaultFile,
  type CognosVaultFileKind,
  type CognosVaultFilter,
  CognosVaultListRowComponent,
  deriveFileExtension,
  resolveFileType,
} from '@cognos/ui-angular';

import {
  AttachmentLibraryService,
  LibraryFile,
} from '@app/attachments/attachment-library.service';
import { ConfirmationDialogComponent } from '@app/components/confirmation-dialog/confirmation-dialog.component';
import { SettingsPageComponent } from '@app/components/settings/settings-page.component';
import { DeviceService } from '@app/services/device.service';
import { VaultService } from '@app/services/vault.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

type ViewMode = 'grid' | 'list';

/** One library file paired with its display-side vault projection. */
interface LibraryRow {
  file: LibraryFile;
  vault: CognosVaultFile;
  refsText: string;
}

/**
 * AccountLibraryComponent is the settings page for the user's attachment library
 * (spec docs/specs/attachments.md): list, search, filter, rename, download and
 * remove the files they've uploaded, and see how many chats use each. It renders
 * with the shared "vault" component family (cards, list rows, filter chips) so it
 * matches the design system; all decryption is client-side via
 * AttachmentLibraryService.
 */
@Component({
  selector: 'app-account-library',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CognosButtonComponent,
    CognosEmptyStateComponent,
    CognosFilterChipsComponent,
    CognosIconButtonComponent,
    CognosModalComponent,
    CognosSearchFieldComponent,
    CognosVaultCardComponent,
    CognosVaultListRowComponent,
    TranslocoModule,
    SettingsPageComponent,
  ],
  template: `
    <ng-container *transloco="let t">
      <app-settings-page
        [heading]="t('library.title')"
        [subtitle]="t('library.subtitle')"
      >
        @if (files().length === 0) {
          <cog-empty-state [message]="t('library.empty')" role="status" />
        } @else {
          <div class="library__toolbar">
            <cog-search-field
              class="library__search"
              [placeholder]="t('library.searchPlaceholder')"
              [ariaLabel]="t('library.searchPlaceholder')"
              (valueChange)="query.set($event)"
            />
            <cog-filter-chips
              [value]="filter()"
              [options]="filterOptions()"
              (change)="filter.set($event)"
            />
            <div class="library__view-toggle">
              <cog-icon-button
                name="layout-grid"
                [title]="t('library.view.grid')"
                [selected]="view() === 'grid'"
                (click)="view.set('grid')"
              />
              <cog-icon-button
                name="list"
                [title]="t('library.view.list')"
                [selected]="view() === 'list'"
                (click)="view.set('list')"
              />
            </div>
          </div>

          @if (rows().length === 0) {
            <cog-empty-state [message]="t('library.noMatches')" role="status" />
          } @else if (view() === 'grid') {
            <div class="library__grid" data-testid="library-page-list">
              @for (row of rows(); track row.file.id) {
                <cog-vault-card
                  [attr.data-testid]="'library-row-' + row.file.id"
                  [file]="row.vault"
                  [moreLabel]="t('library.fileActions')"
                  [refsText]="row.refsText"
                  (open)="openMenu(row.file)"
                  (more)="openMenu(row.file)"
                />
              }
            </div>
          } @else {
            <div class="library__list" data-testid="library-page-list">
              @for (row of rows(); track row.file.id; let index = $index) {
                <cog-vault-list-row
                  [attr.data-testid]="'library-row-' + row.file.id"
                  [file]="row.vault"
                  [top]="index > 0"
                  [moreLabel]="t('library.fileActions')"
                  [refsText]="row.refsText"
                  (open)="openMenu(row.file)"
                  (more)="openMenu(row.file)"
                />
              }
            </div>
          }
        }
      </app-settings-page>

      <!-- Per-file action sheet: opened from a card/row's "more" control. On
           mobile cog-modal renders as a bottom sheet. -->
      <cog-modal
        [open]="menuFile() !== null"
        [width]="420"
        [title]="menuFile()?.displayName ?? ''"
        (close)="closeMenu()"
      >
        @if (renaming()) {
          <label class="library__rename-label" for="library-rename-input">{{
            t('library.rename')
          }}</label>
          <input
            id="library-rename-input"
            class="library__rename"
            data-testid="library-rename-input"
            [value]="renameDraft()"
            (input)="renameDraft.set($any($event.target).value)"
            (keydown.enter)="commitRename()"
            (keydown.escape)="renaming.set(false)"
          />
          <div class="library__modal-footer">
            <cog-button
              appearance="subtle"
              [fullWidth]="isMobile()"
              (click)="renaming.set(false)"
              >{{ t('library.cancel') }}</cog-button
            >
            <cog-button
              appearance="primary"
              [fullWidth]="isMobile()"
              (click)="commitRename()"
              >{{ t('library.renameSave') }}</cog-button
            >
          </div>
        } @else {
          <div class="library__actions">
            <cog-button
              appearance="subtle"
              icon="pencil"
              [fullWidth]="true"
              (click)="startRename()"
              >{{ t('library.rename') }}</cog-button
            >
            <cog-button
              appearance="subtle"
              icon="download"
              [fullWidth]="true"
              (click)="downloadAndClose()"
              >{{ t('library.download') }}</cog-button
            >
            <cog-button
              appearance="danger"
              icon="x"
              [fullWidth]="true"
              (click)="removeAndClose()"
              >{{ t('library.remove') }}</cog-button
            >
          </div>
        }
      </cog-modal>
    </ng-container>
  `,
  styles: [
    `
      .library__toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cog-space-100);
      }
      .library__search {
        flex: 1;
        min-width: 200px;
      }
      .library__view-toggle {
        display: flex;
        gap: var(--cog-space-025, 2px);
        margin-inline-start: auto;
      }
      .library__grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        gap: var(--cog-space-150);
      }
      .library__list {
        overflow: hidden;
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-md);
        background: var(--cog-surface);
      }
      .library__actions {
        display: flex;
        flex-direction: column;
        gap: var(--cog-space-100);
      }
      .library__rename-label {
        display: block;
        margin-bottom: var(--cog-space-075);
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body-sm);
      }
      .library__rename {
        width: 100%;
        font: inherit;
        padding: var(--cog-space-075) var(--cog-space-100);
        border: 2px solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
        background: var(--cog-input-bg);
        color: var(--cog-text);
        outline: 0;
      }
      .library__rename:focus {
        border-color: var(--cog-brand);
      }
      .library__modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--cog-space-100);
        margin-top: var(--cog-space-150);
      }
      @media (max-width: 600px) {
        .library__modal-footer {
          display: grid;
          grid-template-columns: 1fr 1fr;
        }
      }
    `,
  ],
})
export class AccountLibraryComponent {
  private readonly _library = inject(AttachmentLibraryService);
  private readonly _dialog = inject(Dialog);
  private readonly _transloco = inject(TranslocoService);
  private readonly _toast = inject(CognosToastService);
  private readonly _vault = inject(VaultService);
  private readonly _device = inject(DeviceService);

  // Refresh once the vault key is available — covers a deep-link / hard reload
  // where the key unlocks asynchronously after the component mounts.
  private readonly _refreshOnUnlock = effect(() => {
    if (this._vault.keyPair()) {
      this._library.refresh().subscribe({
        next: (files) => this.loadAllUsages(files),
        error: () => undefined,
      });
    }
  });

  readonly isMobile = this._device.isMobile;
  readonly query = signal('');
  readonly filter = signal<CognosVaultFilter>('all');
  readonly view = signal<ViewMode>('grid');
  readonly renameDraft = signal('');
  readonly usageCounts = signal<Record<string, number>>({});

  /** The file whose action sheet is open (null = closed). */
  readonly menuFile = signal<LibraryFile | null>(null);
  /** Whether the action sheet is showing the rename sub-view. */
  readonly renaming = signal(false);

  readonly files = this._library.files;

  readonly filterOptions = computed<CognosFilterChipOption[]>(() => [
    { value: 'all', label: this._transloco.translate('library.filters.all') },
    { value: 'doc', label: this._transloco.translate('library.filters.documents') },
    { value: 'image', label: this._transloco.translate('library.filters.images') },
    { value: 'sheet', label: this._transloco.translate('library.filters.sheets') },
    { value: 'audio', label: this._transloco.translate('library.filters.audio') },
  ]);

  private readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const kind = this.filter();
    return this.files().filter((file) => {
      const matchesQuery = !q || file.displayName.toLowerCase().includes(q);
      const matchesKind = kind === 'all' || this.kindOf(file) === kind;
      return matchesQuery && matchesKind;
    });
  });

  readonly rows = computed<LibraryRow[]>(() =>
    this.filtered().map((file) => ({
      file,
      vault: this.toVaultFile(file),
      refsText: this.refsTextFor(file),
    })),
  );

  openMenu(file: LibraryFile): void {
    this.renaming.set(false);
    this.menuFile.set(file);
  }

  closeMenu(): void {
    this.menuFile.set(null);
    this.renaming.set(false);
  }

  startRename(): void {
    const file = this.menuFile();
    if (!file) {
      return;
    }
    this.renameDraft.set(file.displayName);
    this.renaming.set(true);
  }

  commitRename(): void {
    const file = this.menuFile();
    const name = this.renameDraft().trim();
    this.closeMenu();
    if (!file || !name || name === file.displayName) {
      return;
    }
    this._library.rename(file, name).subscribe({ error: () => undefined });
  }

  async downloadAndClose(): Promise<void> {
    const file = this.menuFile();
    this.closeMenu();
    if (!file) {
      return;
    }
    try {
      await this._library.download(file);
    } catch {
      /* best-effort */
    }
  }

  async removeAndClose(): Promise<void> {
    const file = this.menuFile();
    this.closeMenu();
    if (!file) {
      return;
    }
    const confirmed = await firstValueFrom(
      this._dialog.open<boolean>(ConfirmationDialogComponent, {
        ...cognosDialogOptions,
        data: { message: this._transloco.translate('library.removeConfirm') },
      }).closed,
    );
    if (!confirmed) {
      return;
    }
    this._library.remove(file.id).subscribe({
      next: () =>
        this._toast.notify({ title: this._transloco.translate('library.remove') }),
      error: () => undefined,
    });
  }

  // Eagerly load reference counts so cards can show "In N chats". The usages
  // endpoint is per-file, so this fans out one request per file; fine for a
  // personal library, and a bulk count endpoint is the future optimisation.
  private loadAllUsages(files: LibraryFile[]): void {
    for (const file of files) {
      this._library.usages(file.id).subscribe({
        next: (usages) =>
          this.usageCounts.update((counts) => ({
            ...counts,
            [file.id]: usages.length,
          })),
        error: () => undefined,
      });
    }
  }

  private kindOf(file: LibraryFile): CognosVaultFileKind {
    const ext = deriveFileExtension(file.displayName);
    switch (resolveFileType(ext).icon) {
      case 'image':
        return 'image';
      case 'table':
        return 'sheet';
      case 'music':
        return 'audio';
      default:
        return 'doc';
    }
  }

  private toVaultFile(file: LibraryFile): CognosVaultFile {
    const ext = deriveFileExtension(file.displayName);
    const count = this.usageCounts()[file.id];
    return {
      id: file.id,
      name: file.displayName,
      ext,
      size: this.formatSize(file.sizeBytes),
      meta: resolveFileType(ext).label,
      kind: this.kindOf(file),
      refs: count ?? 0,
      when: this.formatDate(file.createdAt),
    };
  }

  // Empty string hides the reference line until the count is known, so we never
  // flash a misleading "Not referenced".
  private refsTextFor(file: LibraryFile): string {
    const count = this.usageCounts()[file.id];
    if (count === undefined) {
      return '';
    }
    return count > 0
      ? this._transloco.translate('library.refs.inChats', { count })
      : this._transloco.translate('library.refs.none');
  }

  private formatDate(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return new Intl.DateTimeFormat(this._transloco.getActiveLang(), {
      dateStyle: 'medium',
    }).format(date);
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
