import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  input,
  signal,
} from '@angular/core';

import { CognosIconComponent } from '../../icon/icon.component';
import type { CognosVaultFile } from '../../vault/vault.types';
import { CognosSourceCardComponent } from '../source-card/source-card.component';

export type CognosSource = {
  file: CognosVaultFile;
  locator?: string;
  quote?: string;
};

@Component({
  selector: 'cog-sources-row',
  standalone: true,
  imports: [CognosIconComponent, CognosSourceCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-sources-row">
      <button class="cog-sources-row__trigger" type="button" (click)="toggle()">
        <span class="cog-sources-row__trigger-copy">
          <cog-icon name="quote" [size]="14" tone="link" />
          <span>{{ countLabel() }}</span>
        </span>
        <cog-icon
          [name]="open() ? 'chevron-down' : 'chevron-right'"
          [size]="14"
          tone="link"
        />
      </button>

      @if (open()) {
        <div class="cog-sources-row__list">
          @for (
            source of sources();
            track source.file.id + source.locator + source.quote
          ) {
            <cog-source-card
              [file]="source.file"
              [locator]="source.locator || ''"
              [quote]="source.quote || ''"
              [clickable]="true"
            />
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-sources-row {
        display: grid;
        gap: 8px;
      }

      .cog-sources-row__trigger {
        display: inline-flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        border: 0;
        background: transparent;
        padding: 0;
        color: var(--cog-link);
        cursor: pointer;
      }

      .cog-sources-row__trigger-copy {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        line-height: 1.4;
      }

      .cog-sources-row__trigger:focus-visible {
        outline: 2px solid var(--cog-brand);
        outline-offset: 2px;
        border-radius: var(--cog-radius-xs);
      }

      .cog-sources-row__list {
        display: grid;
        gap: 8px;
      }
    `,
  ],
})
export class CognosSourcesRowComponent implements OnInit {
  readonly sources = input<CognosSource[]>([]);
  readonly defaultOpen = input(false);

  protected readonly open = signal(false);
  protected readonly countLabel = computed(() => {
    const count = this.sources().length;
    return `${count} source${count === 1 ? '' : 's'} from your Vault`;
  });

  ngOnInit(): void {
    this.open.set(this.defaultOpen());
  }

  protected toggle(): void {
    this.open.update((value) => !value);
  }
}
