import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';

import { CognosButtonComponent } from '../../button/button.component';
import { CognosFileBadgeComponent } from '../../files/file-badge/file-badge.component';
import { injectIsMobile } from '../../foundations/breakpoint';
import { CognosIconComponent } from '../../icon/icon.component';
import { CognosModalComponent } from '../../overlays/modal/modal.component';
import { CognosTextFieldComponent } from '../../primitives/text-field/text-field.component';
import type { CognosVaultFile } from '../vault.types';

@Component({
  selector: 'cog-vault-picker',
  standalone: true,
  imports: [
    CognosButtonComponent,
    CognosFileBadgeComponent,
    CognosIconComponent,
    CognosModalComponent,
    CognosTextFieldComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-modal
      [open]="true"
      title="Attach from your Vault"
      [width]="520"
      [stickyFooter]="true"
      (close)="close.emit()"
    >
      <div class="cog-vault-picker__body">
        <div class="cog-vault-picker__intro">
          Reference encrypted files in this chat. They're decrypted on your device only
          when the model needs them, then sealed again.
        </div>

        <cog-text-field
          icon="search"
          placeholder="Search the Vault"
          [value]="search()"
          (valueChange)="search.set($event)"
        />

        <div class="cog-vault-picker__list">
          @for (file of filteredFiles(); track file.id; let index = $index) {
            <button
              class="cog-vault-picker__row"
              [class.cog-vault-picker__row--selected]="isSelected(file.id)"
              type="button"
              [style.border-top]="
                index > 0 ? 'var(--cog-border-width) solid var(--cog-border)' : null
              "
              (click)="toggle(file.id)"
            >
              <span
                class="cog-vault-picker__checkbox"
                [class.cog-vault-picker__checkbox--selected]="isSelected(file.id)"
              >
                @if (isSelected(file.id)) {
                  <cog-icon name="check" [size]="12" tone="current" />
                }
              </span>

              @if (file.kind === 'image' && file.img) {
                <span class="cog-vault-picker__thumb"
                  ><img class="cog-vault-picker__thumb-image" [src]="file.img!" alt=""
                /></span>
              } @else {
                <cog-file-badge [ext]="file.ext" [size]="30" [radius]="3" />
              }

              <span class="cog-vault-picker__copy">
                <span class="cog-vault-picker__name">{{ file.name }}</span>
                <span class="cog-vault-picker__details"
                  >{{ file.size }} · {{ file.meta }}</span
                >
              </span>

              <cog-icon name="lock" [size]="12" tone="success" />
            </button>
          }
        </div>
      </div>

      <div cogModalFooter class="cog-vault-picker__footer">
        <span class="cog-vault-picker__count">{{ selectedCount() }} selected</span>
        <div class="cog-vault-picker__actions">
          <cog-button
            appearance="subtle"
            type="button"
            [fullWidth]="isMobile()"
            (click)="close.emit()"
            >Cancel</cog-button
          >
          <cog-button
            appearance="primary"
            icon="paperclip"
            type="button"
            [fullWidth]="isMobile()"
            (click)="attachSelection()"
          >
            Attach {{ selectedCount() || '' }}
          </cog-button>
        </div>
      </div>
    </cog-modal>
  `,
  styles: [
    `
      .cog-vault-picker__body {
        display: grid;
        gap: var(--cog-space-150);
        padding-top: var(--cog-space-050);
      }

      .cog-vault-picker__intro {
        color: var(--cog-text-subtle);
        font-size: 13.5px;
        line-height: 1.5;
      }

      .cog-vault-picker__list {
        overflow: auto;
        max-height: 320px;
        border: var(--cog-border-width) solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
      }

      .cog-vault-picker__row {
        display: flex;
        width: 100%;
        align-items: center;
        gap: var(--cog-space-150);
        border-right: 0;
        border-bottom: 0;
        border-left: 0;
        background: transparent;
        padding: 10px 13px;
        text-align: left;
        cursor: pointer;
      }

      .cog-vault-picker__row--selected {
        background: var(--cog-selected-bg);
      }

      .cog-vault-picker__checkbox {
        display: inline-flex;
        width: 20px;
        height: 20px;
        flex: none;
        align-items: center;
        justify-content: center;
        border: var(--cog-border-width-strong) solid var(--cog-border-bold);
        border-radius: var(--cog-radius-xs);
        color: var(--cog-on-brand);
      }

      .cog-vault-picker__checkbox--selected {
        border-color: var(--cog-brand);
        background: var(--cog-brand);
      }

      .cog-vault-picker__thumb {
        overflow: hidden;
        width: 30px;
        height: 30px;
        border: var(--cog-border-width) solid var(--cog-border);
        border-radius: var(--cog-radius-xs);
      }

      .cog-vault-picker__thumb-image {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .cog-vault-picker__copy {
        min-width: 0;
        flex: 1;
      }

      .cog-vault-picker__name,
      .cog-vault-picker__details {
        display: block;
      }

      .cog-vault-picker__name {
        overflow: hidden;
        color: var(--cog-text);
        font-size: 13.5px;
        font-weight: var(--cog-fw-medium);
        line-height: 1.4;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cog-vault-picker__details {
        margin-top: 1px;
        color: var(--cog-text-subtlest);
        font-size: 12px;
        line-height: 1.4;
      }

      .cog-vault-picker__footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cog-space-100);
      }

      .cog-vault-picker__count {
        color: var(--cog-text-subtle);
        font-size: 13px;
        line-height: 1.4;
      }

      .cog-vault-picker__actions {
        display: flex;
        gap: var(--cog-space-100);
      }

      /* Mobile sheet: stack the count above full-width actions (two at 50%). */
      @media (max-width: 600px) {
        .cog-vault-picker__footer {
          flex-direction: column;
          align-items: stretch;
        }

        .cog-vault-picker__actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
        }
      }
    `,
  ],
})
export class CognosVaultPickerComponent {
  // Full-width footer buttons on the mobile sheet (inline on desktop).
  protected readonly isMobile = injectIsMobile();

  readonly files = input<CognosVaultFile[]>([]);
  readonly initialSelected = input<string[]>([]);
  readonly close = output<void>();
  readonly attach = output<string[]>();

  protected readonly search = signal('');
  private readonly selectedIds = signal<Set<string>>(new Set());
  protected readonly filteredFiles = computed(() => {
    const query = this.search().trim().toLowerCase();

    return this.files().filter(
      (file) => !query || file.name.toLowerCase().includes(query),
    );
  });
  protected readonly selectedCount = computed(() => this.selectedIds().size);

  constructor() {
    effect(() => {
      this.selectedIds.set(new Set(this.initialSelected()));
    });
  }

  @HostListener('window:keydown.escape')
  protected onEscape(): void {
    this.close.emit();
  }

  protected isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  protected toggle(id: string): void {
    this.selectedIds.update((selected) => {
      const next = new Set(selected);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  protected attachSelection(): void {
    const ids = Array.from(this.selectedIds());
    this.attach.emit(ids);
    this.close.emit();
  }
}
