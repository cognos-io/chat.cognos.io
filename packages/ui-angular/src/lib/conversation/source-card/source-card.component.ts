import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { CognosFileBadgeComponent } from '../../files/file-badge/file-badge.component';
import { CognosIconComponent } from '../../icon/icon.component';
import type { CognosVaultFile } from '../../vault/vault.types';

@Component({
  selector: 'cog-source-card',
  standalone: true,
  imports: [CognosFileBadgeComponent, CognosIconComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (clickable()) {
      <button class="cog-source-card" type="button" (click)="open.emit(file())">
        <ng-container [ngTemplateOutlet]="content" />
      </button>
    } @else {
      <article class="cog-source-card">
        <ng-container [ngTemplateOutlet]="content" />
      </article>
    }

    <ng-template #content>
      @if (file().kind === 'image' && file().img) {
        <span class="cog-source-card__thumb"
          ><img class="cog-source-card__thumb-image" [src]="file().img!" alt=""
        /></span>
      } @else {
        <cog-file-badge [ext]="file().ext" [size]="30" [radius]="3" />
      }

      <div class="cog-source-card__copy">
        <div class="cog-source-card__header">
          <span class="cog-source-card__name">{{ file().name }}</span>
          @if (locator()) {
            <span class="cog-source-card__locator">{{ locator() }}</span>
          }
        </div>

        @if (quote()) {
          <blockquote class="cog-source-card__quote">“{{ quote() }}”</blockquote>
        }
      </div>

      <cog-icon name="lock" [size]="12" tone="success" />
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-source-card {
        display: flex;
        width: 100%;
        align-items: flex-start;
        gap: var(--cog-space-100);
        border: var(--cog-border-width) solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
        background: var(--cog-surface);
        padding: var(--cog-space-100) var(--cog-space-150);
        text-align: left;

        &:is(button) {
          cursor: pointer;
        }

        &:is(button):hover {
          border-color: var(--cog-border-bold);
        }

        &:is(button):focus-visible {
          outline: var(--cog-border-width-strong) solid var(--cog-brand);
          outline-offset: var(--cog-border-width-strong);
        }
      }

      .cog-source-card__thumb {
        overflow: hidden;
        width: 30px;
        height: 30px;
        flex: none;
        border: var(--cog-border-width) solid var(--cog-border);
        border-radius: var(--cog-radius-xs);
      }

      .cog-source-card__thumb-image {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .cog-source-card__copy {
        min-width: 0;
        flex: 1;
      }

      .cog-source-card__header {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cog-space-100);
      }

      .cog-source-card__name {
        color: var(--cog-text);
        font-size: var(--cog-fs-body-sm);
        font-weight: var(--cog-fw-semibold);
        line-height: 1.4;
      }

      .cog-source-card__locator {
        color: var(--cog-text-subtle);
        font-family: var(--cog-font-mono);
        font-size: var(--cog-fs-caption);
        line-height: 1.4;
      }

      .cog-source-card__quote {
        margin: var(--cog-space-100) 0 0;
        border-left: var(--cog-border-width-strong) solid var(--cog-border);
        padding-left: var(--cog-space-100);
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body-sm);
        line-height: 1.45;
      }
    `,
  ],
})
export class CognosSourceCardComponent {
  readonly file = input.required<CognosVaultFile>();
  readonly locator = input('');
  readonly quote = input('');
  readonly clickable = input(false);
  readonly open = output<CognosVaultFile>();
}
