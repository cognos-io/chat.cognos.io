import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { CognosIconComponent } from '../../icon/icon.component';
import type { CognosStorageSegment } from '../vault.types';

@Component({
  selector: 'cog-storage-meter',
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cog-storage-meter" [style.width]="widthStyle()">
      <div class="cog-storage-meter__header">
        <span class="cog-storage-meter__eyebrow">
          <cog-icon name="hard-drive" [size]="14" tone="text-subtle" />
          <span>Vault storage</span>
        </span>
        <span class="cog-storage-meter__summary"
          ><strong>{{ used() }}</strong> of {{ total() }}</span
        >
      </div>

      <div class="cog-storage-meter__bar">
        @for (segment of segments(); track segment.label) {
          <span
            class="cog-storage-meter__segment"
            [class]="segmentClass(segment.tone)"
            [style.width.%]="segmentWidth(segment)"
          ></span>
        }
      </div>

      <div class="cog-storage-meter__legend">
        @for (segment of segments(); track segment.label) {
          <span class="cog-storage-meter__legend-item">
            <span
              class="cog-storage-meter__legend-swatch"
              [class]="segmentClass(segment.tone)"
            ></span>
            <span>{{ segment.label }}</span>
          </span>
        }

        <span class="cog-storage-meter__note">
          <cog-icon name="lock" [size]="11" tone="text-subtlest" />
          <span>Encrypted on this device</span>
        </span>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-storage-meter {
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-md);
        background: var(--cog-surface);
        padding: 14px var(--cog-space-200);
      }

      .cog-storage-meter__header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 10px;
      }

      .cog-storage-meter__eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-overline);
        font-weight: var(--cog-fw-overline);
        letter-spacing: var(--cog-ls-overline);
        line-height: var(--cog-lh-overline);
        text-transform: var(--cog-tt-overline);
      }

      .cog-storage-meter__summary {
        color: var(--cog-text-subtle);
        font-size: 12.5px;
        line-height: 1.4;
      }

      .cog-storage-meter__summary strong {
        color: var(--cog-text);
        font-weight: var(--cog-fw-semibold);
      }

      .cog-storage-meter__bar {
        display: flex;
        gap: var(--cog-space-025);
        height: 8px;
        overflow: hidden;
        border-radius: var(--cog-radius-pill);
        background: color-mix(
          in srgb,
          var(--cog-surface-hover) 72%,
          var(--cog-surface-pressed)
        );
      }

      .cog-storage-meter__segment,
      .cog-storage-meter__legend-swatch {
        &.cog-storage-meter__segment--blue {
          background: var(--cog-loz-blue-fg);
        }

        &.cog-storage-meter__segment--green {
          background: var(--cog-loz-green-fg);
        }

        &.cog-storage-meter__segment--purple {
          background: var(--cog-loz-purple-fg);
        }

        &.cog-storage-meter__segment--red {
          background: var(--cog-loz-red-fg);
        }
      }

      .cog-storage-meter__legend {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cog-space-100) var(--cog-space-200);
        margin-top: 11px;
      }

      .cog-storage-meter__legend-item,
      .cog-storage-meter__note {
        display: inline-flex;
        align-items: center;
        gap: var(--cog-space-075);
        color: var(--cog-text-subtle);
        font-size: 12px;
        line-height: 1.4;
      }

      .cog-storage-meter__legend-swatch {
        width: 9px;
        height: 9px;
        border-radius: 2px;
      }

      .cog-storage-meter__note {
        margin-inline-start: auto;
        color: var(--cog-text-subtlest);
        font-size: 11.5px;
      }
    `,
  ],
})
export class CognosStorageMeterComponent {
  readonly width = input<number | string>('100%');
  readonly used = input('1.6 GB');
  readonly total = input('5 GB');
  readonly segments = input<CognosStorageSegment[]>([
    { label: 'Documents', tone: 'blue', used: 17 },
    { label: 'Images', tone: 'purple', used: 9 },
    { label: 'Sheets', tone: 'green', used: 4 },
    { label: 'Audio', tone: 'red', used: 2 },
  ]);

  private readonly totalUsed = computed(() =>
    this.segments().reduce((sum, segment) => sum + segment.used, 0),
  );
  protected readonly widthStyle = computed(() =>
    typeof this.width() === 'number' ? `${this.width()}px` : this.width(),
  );

  protected segmentClass(tone: CognosStorageSegment['tone']): string {
    return `cog-storage-meter__segment--${tone}`;
  }

  protected segmentWidth(segment: CognosStorageSegment): number {
    const totalUsed = this.totalUsed();

    if (totalUsed <= 0) {
      return 0;
    }

    return (segment.used / totalUsed) * 100;
  }
}
