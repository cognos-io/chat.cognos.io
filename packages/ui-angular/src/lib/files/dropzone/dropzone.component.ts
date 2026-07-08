import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { CognosIconComponent } from '../../icon/icon.component';

@Component({
  selector: 'cog-dropzone',
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="cog-dropzone"
      [class]="dropzoneClass()"
      role="button"
      tabindex="0"
      (click)="browse()"
      (keydown.enter)="browse()"
      (keydown.space)="$event.preventDefault(); browse()"
      (dragenter)="onDragEnter($event)"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
    >
      <input
        #picker
        class="cog-dropzone__picker"
        type="file"
        (change)="onPickerChange($event)"
      />

      <span class="cog-dropzone__icon-wrap">
        <cog-icon
          [name]="dragging() ? 'lock' : 'upload-cloud'"
          [size]="22"
          tone="selected"
        />
      </span>

      <div class="cog-dropzone__title">
        {{
          dragging() ? 'Drop to encrypt & add' : 'Drag files here to add to your Vault'
        }}
      </div>
      <div class="cog-dropzone__subtitle">
        or <span class="cog-dropzone__link">browse your device</span>
      </div>
      <div class="cog-dropzone__footer">
        <cog-icon name="lock" [size]="12" tone="text-subtlest" />
        <span>Files are encrypted on this device before they're stored</span>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-dropzone {
        display: grid;
        place-items: center;
        text-align: center;
        cursor: pointer;
        border: var(--cog-border-width-strong) dashed var(--cog-border-bold);
        border-radius: var(--cog-radius-md);
        background: var(--cog-surface);
        padding: var(--cog-space-400) var(--cog-space-300);
        transition:
          background-color 120ms var(--cog-ease-standard),
          border-color 120ms var(--cog-ease-standard);

        &.cog-dropzone--compact {
          padding: var(--cog-space-250) 18px;
        }

        &.cog-dropzone--dragging {
          border-color: var(--cog-brand);
          background: var(--cog-selected-bg);
        }

        &:focus-visible {
          outline: var(--cog-border-width-strong) solid var(--cog-brand);
          outline-offset: var(--cog-border-width-strong);
        }
      }

      .cog-dropzone__picker {
        display: none;
      }

      .cog-dropzone__icon-wrap {
        display: inline-flex;
        width: 46px;
        height: 46px;
        margin-bottom: var(--cog-space-150);
        align-items: center;
        justify-content: center;
        border-radius: var(--cog-radius-pill);
        background: var(--cog-selected-bg);
      }

      .cog-dropzone--dragging .cog-dropzone__icon-wrap {
        background: var(--cog-surface);
      }

      .cog-dropzone__title {
        color: var(--cog-text);
        font-size: var(--cog-fs-body-lg);
        font-weight: var(--cog-fw-semibold);
        line-height: var(--cog-lh-body-lg);
      }

      .cog-dropzone__subtitle {
        margin-top: var(--cog-space-050);
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);
      }

      .cog-dropzone__link {
        color: var(--cog-link);
        font-weight: var(--cog-fw-semibold);
      }

      .cog-dropzone__footer {
        display: inline-flex;
        align-items: center;
        gap: var(--cog-space-075);
        margin-top: 14px;
        color: var(--cog-text-subtlest);
        font-size: 11.5px;
        line-height: 1.4;
      }
    `,
  ],
})
export class CognosDropzoneComponent {
  private readonly picker = viewChild<ElementRef<HTMLInputElement>>('picker');
  private readonly dragDepth = signal(0);

  readonly compact = input(false);
  readonly filesSelected = output<FileList | undefined>();
  protected readonly dragging = computed(() => this.dragDepth() > 0);
  protected readonly dropzoneClass = computed(() => {
    const classes = ['cog-dropzone'];

    if (this.compact()) {
      classes.push('cog-dropzone--compact');
    }

    if (this.dragging()) {
      classes.push('cog-dropzone--dragging');
    }

    return classes.join(' ');
  });

  protected browse(): void {
    this.picker()?.nativeElement.click();
  }

  protected onDragEnter(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth.update((value) => value + 1);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth.update((value) => Math.max(0, value - 1));
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth.set(0);
    this.filesSelected.emit(event.dataTransfer?.files);
  }

  protected onPickerChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.filesSelected.emit(target.files ?? undefined);
    target.value = '';
  }
}
