import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  input,
  signal,
} from '@angular/core';

import { CognosButtonComponent } from '../../button/button.component';

@Component({
  selector: 'cog-code-block',
  standalone: true,
  imports: [CognosButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cog-code-block" [style.width.px]="width()">
      <header class="cog-code-block__header">
        <span class="cog-code-block__lang">{{ lang() }}</span>
        <cog-button
          appearance="subtle"
          type="button"
          [icon]="copied() ? 'check' : 'copy'"
          (click)="copyCode()"
        >
          {{ copied() ? 'Copied' : 'Copy' }}
        </cog-button>
      </header>

      <pre class="cog-code-block__body"><code>{{ code() }}</code></pre>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 100%;
      }

      .cog-code-block {
        overflow: hidden;
        width: min(100%, 480px);
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
        background: var(--cog-surface-hover);
      }

      .cog-code-block__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cog-space-150);
        border-bottom: 1px solid var(--cog-border);
        background: var(--cog-surface);
        padding: 10px var(--cog-space-150);
      }

      .cog-code-block__lang {
        color: var(--cog-text-subtle);
        font-family: var(--cog-font-mono);
        font-size: 12px;
        line-height: 1.4;
        text-transform: lowercase;
      }

      .cog-code-block__body {
        overflow-x: auto;
        margin: 0;
        padding: 13px 14px;
        color: var(--cog-text);
        font-family: var(--cog-font-mono);
        font-size: 12.5px;
        line-height: 1.65;
        white-space: pre;
      }
    `,
  ],
})
export class CognosCodeBlockComponent implements OnDestroy {
  readonly code = input('');
  readonly lang = input('text');
  readonly width = input(480);

  protected readonly copied = signal(false);
  private copyTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  protected async copyCode(): Promise<void> {
    await navigator.clipboard.writeText(this.code());
    this.copied.set(true);

    if (this.copyTimer) {
      globalThis.clearTimeout(this.copyTimer);
    }

    this.copyTimer = globalThis.setTimeout(() => this.copied.set(false), 1400);
  }

  ngOnDestroy(): void {
    if (this.copyTimer) {
      globalThis.clearTimeout(this.copyTimer);
    }
  }
}
