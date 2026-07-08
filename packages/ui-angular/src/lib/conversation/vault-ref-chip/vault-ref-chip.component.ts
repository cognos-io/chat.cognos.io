import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { CognosFileBadgeComponent } from '../../files/file-badge/file-badge.component';
import { CognosIconComponent } from '../../icon/icon.component';
import type { CognosVaultFile } from '../../vault/vault.types';

@Component({
  selector: 'cog-vault-ref-chip',
  standalone: true,
  imports: [CognosFileBadgeComponent, CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-vault-ref-chip" #root>
      <button
        class="cog-vault-ref-chip__trigger"
        type="button"
        [disabled]="!canExpand()"
        (click)="togglePopover()"
      >
        <cog-icon name="folder-lock" [size]="14" tone="selected" />
        <span class="cog-vault-ref-chip__label">{{ label() }}</span>
        @if (canExpand()) {
          <cog-icon
            [name]="open() ? 'chevron-down' : 'chevron-right'"
            [size]="12"
            tone="selected"
          />
        }
      </button>

      @if (clearable()) {
        <button
          class="cog-vault-ref-chip__clear"
          type="button"
          aria-label="Clear Vault references"
          title="Clear Vault references"
          (click)="$event.stopPropagation(); clear.emit()"
        >
          <cog-icon name="x" [size]="12" tone="selected" />
        </button>
      }

      @if (open()) {
        <div class="cog-vault-ref-chip__popover">
          @for (file of files(); track file.id) {
            <div class="cog-vault-ref-chip__item">
              <cog-file-badge [ext]="file.ext" [size]="22" [radius]="3" />
              <span class="cog-vault-ref-chip__item-name">{{ file.name }}</span>
              <cog-icon name="lock" [size]="11" tone="success" />
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      .cog-vault-ref-chip {
        position: relative;
        display: inline-flex;
        align-items: center;
      }

      .cog-vault-ref-chip__trigger,
      .cog-vault-ref-chip__clear {
        border: var(--cog-border-width) solid var(--cog-selected-border);
        background: var(--cog-selected-bg);
        color: var(--cog-selected-text);
      }

      .cog-vault-ref-chip__trigger {
        display: inline-flex;
        min-height: 30px;
        align-items: center;
        gap: var(--cog-space-075);
        border-radius: var(--cog-radius-pill);
        padding: 0 10px;
        cursor: pointer;
      }

      .cog-vault-ref-chip__trigger:disabled {
        cursor: default;
      }

      .cog-vault-ref-chip__trigger:focus-visible,
      .cog-vault-ref-chip__clear:focus-visible {
        outline: var(--cog-border-width-strong) solid var(--cog-brand);
        outline-offset: var(--cog-border-width-strong);
      }

      .cog-vault-ref-chip__label {
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        line-height: 1.4;
      }

      .cog-vault-ref-chip__clear {
        display: inline-flex;
        width: 24px;
        height: 24px;
        margin-left: var(--cog-space-050);
        align-items: center;
        justify-content: center;
        border-radius: var(--cog-radius-pill);
        cursor: pointer;
      }

      .cog-vault-ref-chip__popover {
        position: absolute;
        inset-inline-start: 0;
        inset-block-end: calc(100% + 8px);
        z-index: 10;
        display: grid;
        min-width: 260px;
        gap: var(--cog-space-100);
        border: var(--cog-border-width) solid var(--cog-border);
        border-radius: var(--cog-radius-md);
        background: var(--cog-surface);
        box-shadow: var(--cog-shadow-overlay);
        padding: 10px;
      }

      .cog-vault-ref-chip__item {
        display: flex;
        align-items: center;
        gap: var(--cog-space-100);
      }

      .cog-vault-ref-chip__item-name {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        color: var(--cog-text);
        font-size: 12.5px;
        line-height: 1.4;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
})
export class CognosVaultRefChipComponent {
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');

  readonly files = input<CognosVaultFile[]>([]);
  readonly expandable = input(true);
  readonly clearable = input(false);
  readonly clear = output<void>();

  protected readonly open = signal(false);
  protected readonly canExpand = computed(
    () => this.expandable() && this.files().length > 1,
  );
  protected readonly label = computed(() => {
    const files = this.files();

    if (files.length === 1) {
      return files[0].name;
    }

    return `Using ${files.length} files from your Vault`;
  });

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    if (!this.open()) {
      return;
    }

    const root = this.root()?.nativeElement;
    const target = event.target as Node | null;

    if (root && target && !root.contains(target)) {
      this.open.set(false);
    }
  }

  protected togglePopover(): void {
    if (!this.canExpand()) {
      return;
    }

    this.open.update((value) => !value);
  }
}
