import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import { CognosIconComponent } from '../../icon/icon.component';
import { CognosImageThumbComponent } from '../image-thumb/image-thumb.component';

@Component({
  selector: 'cog-image-grid',
  standalone: true,
  imports: [CognosIconComponent, CognosImageThumbComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visibleImages().length === 1) {
      <button class="cog-image-grid__single" type="button" (click)="openAt(0)">
        <img class="cog-image-grid__single-image" [src]="visibleImages()[0]" alt="" />
        <span class="cog-image-grid__single-lock">
          <cog-icon name="lock" [size]="11" tone="current" />
          <span>{{ encryptedLabel() }}</span>
        </span>
      </button>
    } @else {
      <div class="cog-image-grid" [style.width.px]="width()">
        @for (image of visibleImages(); track image; let index = $index) {
          <div
            class="cog-image-grid__cell"
            [class.cog-image-grid__cell--span]="showWideFirstCell() && index === 0"
          >
            <cog-image-thumb
              [src]="image"
              [height]="showWideFirstCell() && index === 0 ? 150 : 116"
              [more]="index === visibleImages().length - 1 ? hiddenCount() : 0"
              [clickable]="true"
              (open)="openAt(index)"
            />
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 100%;
      }

      .cog-image-grid {
        display: grid;
        width: min(100%, 320px);
        max-width: 100%;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--cog-space-050);
      }

      .cog-image-grid__cell--span {
        grid-column: 1 / -1;
      }

      .cog-image-grid__single {
        position: relative;
        display: inline-block;
        max-width: 100%;
        border: 0;
        background: transparent;
        padding: 0;
        cursor: pointer;
        line-height: 0;

        &:focus-visible {
          outline: var(--cog-border-width-strong) solid var(--cog-brand);
          outline-offset: var(--cog-border-width-strong);
        }
      }

      .cog-image-grid__single-image {
        display: block;
        max-width: min(100%, 320px);
        max-height: 260px;
        border: var(--cog-border-width) solid var(--cog-border);
        border-radius: var(--cog-radius-md);
      }

      .cog-image-grid__single-lock {
        position: absolute;
        inset-inline-start: 8px;
        inset-block-end: 8px;
        display: inline-flex;
        align-items: center;
        gap: var(--cog-space-050);
        min-height: 22px;
        border-radius: var(--cog-radius-pill);
        background: rgba(9, 30, 66, 0.62);
        padding: 0 var(--cog-space-100);
        color: #fff;
        font-size: var(--cog-fs-overline);
        font-weight: var(--cog-fw-semibold);
        line-height: 1.4;
      }
    `,
  ],
})
export class CognosImageGridComponent {
  readonly images = input<string[]>([]);
  readonly max = input(4);
  readonly width = input(320);
  // English default; consumers pass a localised "Encrypted" label.
  readonly encryptedLabel = input('Encrypted');
  readonly open = output<number>();

  protected readonly visibleImages = computed(() => this.images().slice(0, this.max()));
  protected readonly hiddenCount = computed(() =>
    Math.max(0, this.images().length - this.visibleImages().length),
  );
  protected readonly showWideFirstCell = computed(
    () => this.visibleImages().length === 3,
  );

  protected openAt(index: number): void {
    this.open.emit(index);
  }
}
