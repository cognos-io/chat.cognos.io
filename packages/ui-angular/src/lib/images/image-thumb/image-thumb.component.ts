import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { CognosIconComponent } from '../../icon/icon.component';

@Component({
  selector: 'cog-image-thumb',
  standalone: true,
  imports: [CognosIconComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (clickable()) {
      <button
        class="cog-image-thumb"
        [style.height.px]="height()"
        [style.border-radius.px]="round()"
        type="button"
        (click)="open.emit()"
      >
        <ng-container [ngTemplateOutlet]="content" />
      </button>
    } @else {
      <div
        class="cog-image-thumb"
        [style.height.px]="height()"
        [style.border-radius.px]="round()"
      >
        <ng-container [ngTemplateOutlet]="content" />
      </div>
    }

    <ng-template #content>
      <img
        class="cog-image-thumb__image"
        [class.cog-image-thumb__image--contain]="!cover()"
        [src]="src()"
        alt=""
      />

      @if (lock()) {
        <span class="cog-image-thumb__lock">
          <cog-icon name="lock" [size]="12" tone="current" />
        </span>
      }

      @if (more() > 0) {
        <span class="cog-image-thumb__more">+{{ more() }}</span>
      }
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .cog-image-thumb {
        position: relative;
        display: block;
        width: 100%;
        overflow: hidden;
        border: var(--cog-border-width) solid var(--cog-border);
        background: var(--cog-surface-sunken, var(--cog-surface-hover));
        padding: 0;
        line-height: 0;

        &:is(button) {
          cursor: pointer;
        }

        &:is(button):hover .cog-image-thumb__image {
          filter: brightness(0.94);
        }

        &:is(button):focus-visible {
          outline: var(--cog-border-width-strong) solid var(--cog-brand);
          outline-offset: var(--cog-border-width-strong);
        }
      }

      .cog-image-thumb__image {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: filter var(--cog-dur-fast) var(--cog-ease-standard);
      }

      .cog-image-thumb__image--contain {
        object-fit: contain;
      }

      .cog-image-thumb__lock {
        position: absolute;
        inset-inline-start: 7px;
        inset-block-end: 7px;
        display: inline-flex;
        width: 22px;
        height: 22px;
        align-items: center;
        justify-content: center;
        border-radius: var(--cog-radius-pill);
        background: rgba(9, 30, 66, 0.62);
        backdrop-filter: blur(4px);
        color: #fff;
      }

      .cog-image-thumb__more {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: rgba(9, 30, 66, 0.58);
        color: #fff;
        font-size: var(--cog-fs-h-lg);
        font-weight: var(--cog-fw-semibold);
        line-height: 1;
      }
    `,
  ],
})
export class CognosImageThumbComponent {
  readonly src = input('');
  readonly height = input(132);
  readonly round = input(8);
  readonly cover = input(true);
  readonly lock = input(true);
  readonly more = input(0);
  readonly clickable = input(false);
  readonly open = output<void>();
}
