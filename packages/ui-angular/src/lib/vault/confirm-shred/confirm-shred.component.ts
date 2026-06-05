import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  input,
  output,
} from "@angular/core";

import { CognosButtonComponent } from "../../button/button.component";
import { CognosSectionMessageComponent } from "../../chat/section-message/section-message.component";
import { CognosDocAttachmentComponent } from "../../files/doc-attachment/doc-attachment.component";
import { CognosModalComponent } from "../../overlays/modal/modal.component";
import type { CognosVaultFile } from "../vault.types";

@Component({
  selector: "cog-confirm-shred",
  standalone: true,
  imports: [
    CognosButtonComponent,
    CognosDocAttachmentComponent,
    CognosModalComponent,
    CognosSectionMessageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-modal
      [open]="true"
      title="Shred this file?"
      titleIcon="shield-x"
      titleTone="danger"
      [width]="460"
      [stickyFooter]="true"
      (close)="close.emit()"
    >
      <div class="cog-confirm-shred__body">
        <p class="cog-confirm-shred__text">
          Shredding destroys the encryption key for <strong>{{ file().name }}</strong>. The ciphertext can never be opened again — not by you, not by anyone with whom it was shared, not by Cognos.
        </p>

        <div class="cog-confirm-shred__preview">
          <cog-doc-attachment
            [name]="file().name"
            [ext]="file().ext"
            [size]="file().size"
            [meta]="file().meta"
            [width]="'100%'"
          />
        </div>

        @if (file().refs > 0) {
          <div class="cog-confirm-shred__warning">
            <cog-section-message tone="info" icon="link">
              It's referenced in {{ file().refs }} chat{{ file().refs === 1 ? '' : 's' }}. Those messages will keep their text, but the file behind them will be unrecoverable.
            </cog-section-message>
          </div>
        }
      </div>

      <div cogModalFooter class="cog-confirm-shred__footer">
        <cog-button appearance="subtle" type="button" (click)="close.emit()">
          Cancel
        </cog-button>
        <cog-button
          appearance="danger"
          icon="shield-x"
          type="button"
          (click)="confirmShred()"
        >
          Shred permanently
        </cog-button>
      </div>
    </cog-modal>
  `,
  styles: [
    `
      .cog-confirm-shred__body {
        display: grid;
        gap: 16px;
      }

      .cog-confirm-shred__text {
        margin: 0;
        color: var(--cog-text-subtle);
        font-size: 13.5px;
        line-height: 1.55;
      }

      .cog-confirm-shred__text strong {
        color: var(--cog-text);
      }

      .cog-confirm-shred__footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
    `,
  ],
})
export class CognosConfirmShredComponent {
  readonly file = input.required<CognosVaultFile>();
  readonly close = output<void>();
  readonly confirm = output<CognosVaultFile>();

  @HostListener("window:keydown.escape")
  protected onEscape(): void {
    this.close.emit();
  }

  protected confirmShred(): void {
    this.confirm.emit(this.file());
    this.close.emit();
  }
}
