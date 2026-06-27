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
  CognosIconComponent,
  CognosToastService,
} from '@cognos/ui-angular';

import {
  AttachmentLibraryService,
  LibraryFile,
} from '@app/attachments/attachment-library.service';
import { ConfirmationDialogComponent } from '@app/components/confirmation-dialog/confirmation-dialog.component';
import { VaultService } from '@app/services/vault.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

/**
 * AccountLibraryComponent is the settings page for the user's attachment library
 * (spec docs/specs/attachments.md): list, search, rename, download, and remove the
 * files they've uploaded, and see how many chats use each. All decryption is
 * client-side via AttachmentLibraryService.
 */
@Component({
  selector: 'app-account-library',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CognosButtonComponent, CognosIconComponent, TranslocoModule],
  template: `
    <ng-container *transloco="let t">
      <header class="library-page__header">
        <h1 class="library-page__title">{{ t('library.title') }}</h1>
      </header>

      <input
        type="search"
        class="library-page__search"
        data-testid="library-page-search"
        [attr.placeholder]="t('library.searchPlaceholder')"
        [attr.aria-label]="t('library.searchPlaceholder')"
        (input)="query.set($any($event.target).value)"
      />

      @if (filtered().length === 0) {
        <p class="library-page__empty">{{ t('library.empty') }}</p>
      } @else {
        <ul class="library-page__list" data-testid="library-page-list">
          @for (file of filtered(); track file.id) {
            <li
              class="library-page__item"
              [attr.data-testid]="'library-row-' + file.id"
            >
              <cog-icon name="file-text" [size]="20" tone="text-subtle" />
              <div class="library-page__main">
                @if (editingId() === file.id) {
                  <input
                    class="library-page__rename"
                    [value]="file.displayName"
                    (input)="renameDraft.set($any($event.target).value)"
                    (keydown.enter)="commitRename(file)"
                    (keydown.escape)="editingId.set(null)"
                  />
                } @else {
                  <span class="library-page__name" [title]="file.displayName">{{
                    file.displayName
                  }}</span>
                }
                <span class="library-page__meta">
                  {{ formatSize(file.sizeBytes) }}
                  @if (usageCounts()[file.id] !== undefined) {
                    · {{ t('library.usedIn', { count: usageCounts()[file.id] }) }}
                  }
                </span>
              </div>
              <div class="library-page__actions">
                @if (editingId() === file.id) {
                  <cog-button appearance="primary" (click)="commitRename(file)">{{
                    t('library.renameSave')
                  }}</cog-button>
                } @else {
                  <cog-button
                    appearance="subtle"
                    (click)="loadUsages(file)"
                    [attr.data-testid]="'library-usedin-' + file.id"
                    >{{
                      t('library.usedIn', { count: usageCounts()[file.id] ?? '…' })
                    }}</cog-button
                  >
                  <cog-button appearance="subtle" (click)="download(file)">{{
                    t('library.download')
                  }}</cog-button>
                  <cog-button appearance="subtle" (click)="startRename(file)">{{
                    t('library.rename')
                  }}</cog-button>
                  <cog-button
                    appearance="danger"
                    [attr.data-testid]="'library-remove-' + file.id"
                    (click)="remove(file)"
                    >{{ t('library.remove') }}</cog-button
                  >
                }
              </div>
            </li>
          }
        </ul>
      }
    </ng-container>
  `,
  styles: [
    `
      .library-page__title {
        margin: 0 0 1rem;
      }
      .library-page__search {
        width: 100%;
        padding: 0.5rem 0.75rem;
        margin-bottom: 1rem;
        border: 1px solid var(--cog-color-border, rgba(0, 0, 0, 0.1));
        border-radius: 0.5rem;
        font: inherit;
      }
      .library-page__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .library-page__item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem;
        border: 1px solid var(--cog-color-border, rgba(0, 0, 0, 0.1));
        border-radius: 0.625rem;
      }
      .library-page__main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .library-page__name {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .library-page__rename {
        font: inherit;
        padding: 0.25rem 0.5rem;
        border: 1px solid var(--cog-color-border, rgba(0, 0, 0, 0.2));
        border-radius: 0.375rem;
      }
      .library-page__meta {
        font-size: 0.8125rem;
        color: var(--cog-color-text-subtle, rgba(0, 0, 0, 0.55));
      }
      .library-page__actions {
        display: flex;
        gap: 0.25rem;
        flex-wrap: wrap;
      }
      .library-page__empty {
        color: var(--cog-color-text-subtle, rgba(0, 0, 0, 0.55));
        text-align: center;
        margin: 2rem 0;
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

  // Refresh once the vault key is available — covers a deep-link / hard reload
  // where the key unlocks asynchronously after the component mounts.
  private readonly _refreshOnUnlock = effect(() => {
    if (this._vault.keyPair()) {
      this._library.refresh().subscribe({ error: () => undefined });
    }
  });

  readonly query = signal('');
  readonly editingId = signal<string | null>(null);
  readonly renameDraft = signal('');
  readonly usageCounts = signal<Record<string, number>>({});

  readonly files = this._library.files;
  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const files = this.files();
    return q ? files.filter((f) => f.displayName.toLowerCase().includes(q)) : files;
  });

  startRename(file: LibraryFile): void {
    this.renameDraft.set(file.displayName);
    this.editingId.set(file.id);
  }

  commitRename(file: LibraryFile): void {
    const name = this.renameDraft().trim();
    this.editingId.set(null);
    if (!name || name === file.displayName) {
      return;
    }
    this._library.rename(file, name).subscribe({ error: () => undefined });
  }

  loadUsages(file: LibraryFile): void {
    this._library.usages(file.id).subscribe({
      next: (usages) =>
        this.usageCounts.update((counts) => ({ ...counts, [file.id]: usages.length })),
      error: () => undefined,
    });
  }

  async download(file: LibraryFile): Promise<void> {
    try {
      await this._library.download(file);
    } catch {
      /* best-effort */
    }
  }

  async remove(file: LibraryFile): Promise<void> {
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
