import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  afterNextRender,
  input,
  output,
  viewChild,
} from '@angular/core';

import { CognosIconComponent } from '../../icon/icon.component';
import { CognosLozengeComponent } from '../../primitives/lozenge/lozenge.component';

@Component({
  selector: 'cog-lightbox',
  standalone: true,
  imports: [CognosIconComponent, CognosLozengeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-lightbox" (click)="close.emit()">
      <div class="cog-lightbox__header" (click)="$event.stopPropagation()">
        <div class="cog-lightbox__title-wrap">
          <cog-icon name="image" [size]="16" tone="current" />
          <span class="cog-lightbox__title">{{ name() }}</span>
          <cog-lozenge tone="green">Encrypted</cog-lozenge>
        </div>

        <div class="cog-lightbox__actions">
          <button
            class="cog-lightbox__action"
            type="button"
            title="Download"
            aria-label="Download"
            (click)="download.emit()"
          >
            <cog-icon name="download" [size]="17" tone="current" />
          </button>
          <button
            class="cog-lightbox__action"
            type="button"
            title="Save to Vault"
            aria-label="Save to Vault"
            (click)="saveToVault.emit()"
          >
            <cog-icon name="folder-plus" [size]="17" tone="current" />
          </button>
          <button
            #closeButton
            class="cog-lightbox__action"
            type="button"
            title="Close"
            aria-label="Close"
            (click)="close.emit()"
          >
            <cog-icon name="x" [size]="17" tone="current" />
          </button>
        </div>
      </div>

      <div class="cog-lightbox__body">
        <img
          class="cog-lightbox__image"
          [src]="src()"
          [alt]="name()"
          (click)="$event.stopPropagation()"
        />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 300;
      }

      .cog-lightbox {
        display: flex;
        height: 100%;
        flex-direction: column;
        background: rgba(9, 30, 66, 0.82);
      }

      .cog-lightbox__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 18px;
        color: #fff;
      }

      .cog-lightbox__title-wrap {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 12px;
      }

      .cog-lightbox__title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 14px;
        font-weight: var(--cog-fw-medium);
        line-height: var(--cog-lh-body);
      }

      .cog-lightbox__actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .cog-lightbox__action {
        display: inline-flex;
        width: 34px;
        height: 34px;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: var(--cog-radius-sm);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        cursor: pointer;

        &:hover {
          background: rgba(255, 255, 255, 0.16);
        }

        &:focus-visible {
          outline: 2px solid #fff;
          outline-offset: 2px;
        }
      }

      .cog-lightbox__body {
        display: flex;
        min-height: 0;
        flex: 1;
        align-items: center;
        justify-content: center;
        padding: 0 24px 28px;
      }

      .cog-lightbox__image {
        max-width: 92%;
        max-height: 100%;
        border-radius: var(--cog-radius-md);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
      }
    `,
  ],
})
export class CognosLightboxComponent implements OnDestroy {
  private readonly closeButton =
    viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private readonly previousFocus = globalThis.document
    ?.activeElement as HTMLElement | null;

  readonly src = input('');
  readonly name = input('image.png');
  readonly close = output<void>();
  readonly download = output<void>();
  readonly saveToVault = output<void>();

  constructor() {
    afterNextRender(() => this.closeButton()?.nativeElement.focus());
  }

  @HostListener('window:keydown.escape')
  protected onEscape(): void {
    this.close.emit();
  }

  ngOnDestroy(): void {
    this.previousFocus?.focus?.();
  }
}
