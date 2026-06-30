import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

import { CognosButtonComponent } from '../../button/button.component';
import { CognosDropzoneComponent } from '../../files/dropzone/dropzone.component';
import { CognosIconComponent } from '../../icon/icon.component';
import { CognosBreadcrumbsComponent } from '../../navigation/breadcrumbs/breadcrumbs.component';
import { CognosIconButtonComponent } from '../../primitives/icon-button/icon-button.component';
import { CognosLozengeComponent } from '../../primitives/lozenge/lozenge.component';
import { CognosTextFieldComponent } from '../../primitives/text-field/text-field.component';
import { CognosFilterChipsComponent } from '../filter-chips/filter-chips.component';
import { CognosStorageMeterComponent } from '../storage-meter/storage-meter.component';
import { CognosVaultCardComponent } from '../vault-card/vault-card.component';
import { CognosVaultListRowComponent } from '../vault-list-row/vault-list-row.component';
import type {
  CognosStorageSegment,
  CognosVaultFile,
  CognosVaultFilter,
} from '../vault.types';

@Component({
  selector: 'cog-vault-page',
  standalone: true,
  imports: [
    CognosBreadcrumbsComponent,
    CognosButtonComponent,
    CognosDropzoneComponent,
    CognosFilterChipsComponent,
    CognosIconButtonComponent,
    CognosIconComponent,
    CognosLozengeComponent,
    CognosStorageMeterComponent,
    CognosTextFieldComponent,
    CognosVaultCardComponent,
    CognosVaultListRowComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cog-vault-page">
      <header class="cog-vault-page__header">
        <cog-breadcrumbs [items]="breadcrumbs" />

        <div class="cog-vault-page__title-row">
          <span class="cog-vault-page__tile">
            <cog-icon name="folder-lock" [size]="20" tone="selected" />
          </span>

          <div class="cog-vault-page__title-copy">
            <h1 class="cog-vault-page__title">Vault</h1>
            <div class="cog-vault-page__meta">
              <span>{{ files().length }} files · personal to you</span>
              <cog-lozenge tone="green">Encrypted</cog-lozenge>
            </div>
          </div>

          <cog-button
            appearance="primary"
            icon="upload"
            type="button"
            (click)="addFiles.emit()"
          >
            Add files
          </cog-button>
        </div>
      </header>

      @if (empty() || files().length === 0) {
        <div class="cog-vault-page__empty">
          <span class="cog-vault-page__empty-tile">
            <cog-icon name="folder-lock" [size]="28" tone="selected" />
          </span>
          <h2 class="cog-vault-page__empty-title">Your Vault is empty</h2>
          <p class="cog-vault-page__empty-copy">
            Add documents, images or notes once and reference them in any chat.
            Everything is encrypted on this device — only you hold the keys.
          </p>
          <cog-dropzone (filesSelected)="filesDropped.emit($event)" />
        </div>
      } @else {
        <div class="cog-vault-page__toolbar">
          <div class="cog-vault-page__search">
            <cog-text-field
              icon="search"
              placeholder="Search the Vault"
              [value]="search()"
              (valueChange)="search.set($event)"
            />
          </div>

          <cog-filter-chips [value]="filter()" (change)="filter.set($event)" />

          <div class="cog-vault-page__view-toggle">
            <cog-icon-button
              name="layout-grid"
              title="Grid view"
              [selected]="view() === 'grid'"
              (click)="view.set('grid')"
            />
            <cog-icon-button
              name="list"
              title="List view"
              [selected]="view() === 'list'"
              (click)="view.set('list')"
            />
          </div>
        </div>

        <div class="cog-vault-page__storage">
          <cog-storage-meter
            [used]="storageUsed()"
            [total]="storageTotal()"
            [segments]="storageSegments()"
            [width]="'100%'"
          />
        </div>

        @if (view() === 'grid') {
          <div class="cog-vault-page__grid">
            @for (file of filteredFiles(); track file.id) {
              <cog-vault-card
                [file]="file"
                (open)="fileOpen.emit($event)"
                (more)="fileMore.emit($event)"
              />
            }
          </div>
        } @else {
          <div class="cog-vault-page__list">
            @for (file of filteredFiles(); track file.id; let index = $index) {
              <cog-vault-list-row
                [file]="file"
                [top]="index > 0"
                (open)="fileOpen.emit($event)"
                (more)="fileMore.emit($event)"
              />
            }
          </div>
        }
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .cog-vault-page {
        overflow: hidden;
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-md);
        background: var(--cog-app-bg);
      }

      .cog-vault-page__header {
        border-bottom: 1px solid var(--cog-border);
        background: var(--cog-surface);
        padding: 14px var(--cog-space-250) var(--cog-space-200);
      }

      .cog-vault-page__title-row {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        margin-top: var(--cog-space-075);
      }

      .cog-vault-page__tile,
      .cog-vault-page__empty-tile {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--cog-radius-sm);
        background: var(--cog-selected-bg);
      }

      .cog-vault-page__tile {
        width: 40px;
        height: 40px;
      }

      .cog-vault-page__title-copy {
        min-width: 0;
        flex: 1;
      }

      .cog-vault-page__title {
        margin: 0;
        color: var(--cog-text);
        font-size: var(--cog-fs-h-lg);
        font-weight: var(--cog-fw-h-lg);
        line-height: var(--cog-lh-h-lg);
      }

      .cog-vault-page__meta {
        display: flex;
        align-items: center;
        gap: var(--cog-space-100);
        margin-top: 3px;
        color: var(--cog-text-subtle);
        font-size: 13px;
        line-height: 1.4;
      }

      .cog-vault-page__toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        padding: var(--cog-space-200) var(--cog-space-250) 0;
      }

      .cog-vault-page__search {
        width: 220px;
        max-width: 100%;
      }

      .cog-vault-page__view-toggle {
        display: flex;
        gap: var(--cog-space-025);
        margin-inline-start: auto;
      }

      .cog-vault-page__storage {
        padding: 14px var(--cog-space-250) 0;
      }

      .cog-vault-page__grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        gap: var(--cog-space-150);
        padding: 14px var(--cog-space-250) var(--cog-space-300);
      }

      .cog-vault-page__list {
        overflow: hidden;
        margin: 14px var(--cog-space-250) var(--cog-space-300);
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-md);
        background: var(--cog-surface);
      }

      .cog-vault-page__empty {
        max-width: 520px;
        margin: 0 auto;
        padding: var(--cog-space-500) 28px var(--cog-space-600);
        text-align: center;
      }

      .cog-vault-page__empty-tile {
        width: 56px;
        height: 56px;
        margin-bottom: 18px;
        border-radius: var(--cog-radius-md);
      }

      .cog-vault-page__empty-title {
        margin: 0;
        color: var(--cog-text);
        font-size: var(--cog-fs-h-md);
        font-weight: var(--cog-fw-h-md);
        line-height: var(--cog-lh-h-md);
      }

      .cog-vault-page__empty-copy {
        max-width: 420px;
        margin: var(--cog-space-100) auto 22px;
        color: var(--cog-text-subtle);
        font-size: 14px;
        line-height: 1.55;
      }
    `,
  ],
})
export class CognosVaultPageComponent {
  readonly files = input<CognosVaultFile[]>([]);
  readonly storageUsed = input('1.6 GB');
  readonly storageTotal = input('5 GB');
  readonly storageSegments = input<CognosStorageSegment[]>([
    { label: 'Documents', tone: 'blue', used: 17 },
    { label: 'Images', tone: 'purple', used: 9 },
    { label: 'Sheets', tone: 'green', used: 4 },
    { label: 'Audio', tone: 'red', used: 2 },
  ]);
  readonly empty = input(false);
  readonly addFiles = output<void>();
  readonly filesDropped = output<FileList | undefined>();
  readonly fileOpen = output<CognosVaultFile>();
  readonly fileMore = output<CognosVaultFile>();

  protected readonly breadcrumbs = [
    { label: 'Cognos' },
    { label: 'Vault', current: true },
  ];
  protected readonly search = signal('');
  protected readonly filter = signal<CognosVaultFilter>('all');
  protected readonly view = signal<'grid' | 'list'>('grid');
  protected readonly filteredFiles = computed(() => {
    const query = this.search().trim().toLowerCase();

    return this.files().filter((file) => {
      const matchesFilter = this.filter() === 'all' || file.kind === this.filter();
      const matchesQuery = !query || file.name.toLowerCase().includes(query);
      return matchesFilter && matchesQuery;
    });
  });
}
