import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { CognosIconComponent } from '../../icon/icon.component';

@Component({
  selector: 'cog-user-message',
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="cog-user-message">
      <div class="cog-user-message__bubble">
        <div class="cog-user-message__body cog-prose">
          <ng-content />
        </div>
      </div>

      @if (meta() || securing()) {
        <footer class="cog-user-message__meta">
          @if (securing()) {
            <span class="cog-user-message__loader" aria-hidden="true">
              <span></span><span></span><span></span>
            </span>
            <span>{{ securingLabel() }}</span>
          } @else {
            <cog-icon name="lock" [size]="12" tone="text-subtlest" />
            <span>{{ meta() }}</span>
          }
        </footer>
      }

      <div class="cog-user-message__actions">
        <ng-content select="[cogMessageActions]" />
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-user-message {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
      }

      .cog-user-message__bubble {
        display: grid;
        max-width: min(88%, 620px);
        gap: var(--cog-space-100);
        border-radius: var(--cog-radius-md) var(--cog-radius-md) var(--cog-radius-xs)
          var(--cog-radius-md);
        background: var(--cog-selected-bg);
        padding: 14px;
        color: var(--cog-text);
      }

      .cog-user-message__body {
        font-size: var(--cog-fs-body-lg);
        line-height: var(--cog-lh-body-lg);
      }

      .cog-user-message__actions {
        display: flex;
        justify-content: flex-end;
        margin-top: var(--cog-space-050);
        opacity: 0;
        transition: opacity var(--cog-dur-fast) var(--cog-ease-standard);
      }

      .cog-user-message__actions:empty {
        display: none;
      }

      .cog-user-message:hover .cog-user-message__actions,
      .cog-user-message:focus-within .cog-user-message__actions {
        opacity: 1;
      }

      .cog-user-message__meta {
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--cog-space-050);
        margin-top: var(--cog-space-100);
        padding-inline-end: 2px;
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-caption);
        line-height: var(--cog-lh-caption);
      }

      .cog-user-message__loader {
        display: inline-flex;
        gap: 2px;
      }

      .cog-user-message__loader span {
        width: 4px;
        height: 4px;
        border-radius: var(--cog-radius-pill);
        background: currentColor;
        animation: cog-user-message-blink 1s infinite;
      }

      .cog-user-message__loader span:nth-child(2) {
        animation-delay: 120ms;
      }

      .cog-user-message__loader span:nth-child(3) {
        animation-delay: 240ms;
      }

      @keyframes cog-user-message-blink {
        0%,
        80%,
        100% {
          opacity: 0.3;
        }

        40% {
          opacity: 1;
        }
      }
    `,
  ],
})
export class CognosUserMessageComponent {
  readonly meta = input('');
  readonly securing = input(false);
  readonly securingLabel = input('Securing…');
}
