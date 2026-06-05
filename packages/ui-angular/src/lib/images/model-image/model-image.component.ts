import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";

import { CognosButtonComponent } from "../../button/button.component";
import { CognosIconButtonComponent } from "../../primitives/icon-button/icon-button.component";
import { CognosLozengeComponent, type CognosLozengeTone } from "../../primitives/lozenge/lozenge.component";

export type CognosModelImageState = "done" | "generating";

@Component({
  selector: "cog-model-image",
  standalone: true,
  imports: [
    CognosButtonComponent,
    CognosIconButtonComponent,
    CognosLozengeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-model-image" [style.width.px]="width()">
      @if (state() === "generating") {
        <div class="cog-model-image__placeholder">
          <span class="cog-model-image__shimmer"></span>
          <div class="cog-model-image__placeholder-copy">
            <span class="cog-model-image__sparkles">✦</span>
            <div>Generating on {{ host() }}…</div>
          </div>
        </div>
      } @else {
        <button class="cog-model-image__preview" type="button" (click)="open.emit()">
          <img class="cog-model-image__img" [src]="src()!" alt="Generated model image" />
        </button>
      }

      <div class="cog-model-image__meta">
        <cog-lozenge [tone]="tone()">{{ tag() }}</cog-lozenge>
        <span class="cog-model-image__caption">Generated · re-encrypted on return</span>
      </div>

      @if (prompt()) {
        <div class="cog-model-image__prompt"><span class="cog-model-image__prompt-label">Prompt · </span>{{ prompt() }}</div>
      }

      @if (state() !== "generating") {
        <div class="cog-model-image__actions">
          <div class="cog-model-image__tools">
            <cog-icon-button name="download" title="Download" (click)="download.emit()" />
            <cog-icon-button name="refresh-cw" title="Regenerate" (click)="regenerate.emit()" />
            <cog-icon-button name="copy-plus" title="Variations" (click)="variations.emit()" />
          </div>

          <cog-button appearance="subtle" icon="folder-plus" type="button" (click)="saveToVault.emit()">
            Save to Vault
          </cog-button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 100%;
      }

      .cog-model-image {
        width: min(100%, 380px);
        max-width: 100%;
      }

      .cog-model-image__preview {
        display: block;
        width: 100%;
        border: 0;
        background: transparent;
        padding: 0;
        cursor: pointer;
        line-height: 0;

        &:focus-visible {
          outline: 2px solid var(--cog-brand);
          outline-offset: 2px;
        }
      }

      .cog-model-image__img {
        display: block;
        width: 100%;
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-md);
      }

      .cog-model-image__placeholder {
        position: relative;
        display: flex;
        height: 240px;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-md);
        background: var(--cog-surface-hover);
      }

      .cog-model-image__shimmer {
        position: absolute;
        inset: 0;
        background: linear-gradient(105deg, transparent 35%, var(--cog-surface) 50%, transparent 65%);
        animation: cog-model-image-shimmer 1.3s ease-in-out infinite;
      }

      .cog-model-image__placeholder-copy {
        position: relative;
        text-align: center;
        color: var(--cog-text-subtle);
        font-size: 13px;
        line-height: 1.45;
      }

      .cog-model-image__sparkles {
        display: block;
        margin-bottom: 8px;
        color: var(--cog-link);
        font-size: 22px;
      }

      .cog-model-image__meta {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
      }

      .cog-model-image__caption {
        color: var(--cog-text-subtlest);
        font-size: 12px;
        line-height: 1.4;
      }

      .cog-model-image__prompt {
        margin-top: 8px;
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
        background: var(--cog-surface-hover);
        padding: 8px 11px;
        color: var(--cog-text-subtle);
        font-size: 12.5px;
        line-height: 1.45;
      }

      .cog-model-image__prompt-label {
        color: var(--cog-text-subtlest);
      }

      .cog-model-image__actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 8px;
      }

      .cog-model-image__tools {
        display: flex;
        gap: 2px;
      }

      @keyframes cog-model-image-shimmer {
        from {
          transform: translateX(-60%);
        }

        to {
          transform: translateX(60%);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .cog-model-image__shimmer {
          animation: none;
        }
      }
    `,
  ],
})
export class CognosModelImageComponent {
  readonly src = input<string | null>(null);
  readonly prompt = input("");
  readonly state = input<CognosModelImageState>("done");
  readonly tag = input("SWISS CLOUD");
  readonly tone = input<CognosLozengeTone>("blue");
  readonly host = input("Swiss cloud");
  readonly width = input(380);
  readonly open = output<void>();
  readonly download = output<void>();
  readonly regenerate = output<void>();
  readonly variations = output<void>();
  readonly saveToVault = output<void>();
}
