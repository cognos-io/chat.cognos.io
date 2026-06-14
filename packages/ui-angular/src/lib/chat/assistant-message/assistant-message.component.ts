import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { CognosIconComponent } from '../../icon/icon.component';
import { CognosIconButtonComponent } from '../../primitives/icon-button/icon-button.component';
import { CognosLozengeComponent } from '../../primitives/lozenge/lozenge.component';

@Component({
  selector: 'cog-assistant-message',
  standalone: true,
  imports: [CognosIconComponent, CognosIconButtonComponent, CognosLozengeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="cog-assistant-message">
      <span class="cog-assistant-message__avatar">
        <cog-icon name="lock" [size]="16" tone="current" />
      </span>

      <div class="cog-assistant-message__content">
        <header class="cog-assistant-message__header">
          <div class="cog-assistant-message__heading">
            <span class="cog-assistant-message__model">{{ model() }}</span>

            @if (encrypted()) {
              <cog-lozenge tone="green">Encrypted</cog-lozenge>
            }

            @if (time()) {
              <span class="cog-assistant-message__time">{{ time() }}</span>
            }
          </div>

          @if (showActions()) {
            <div class="cog-assistant-message__actions">
              <cog-icon-button name="copy" title="Copy message" />
              <cog-icon-button name="rotate-cw" title="Regenerate response" />
            </div>
          }
        </header>

        <div class="cog-assistant-message__body">
          <ng-content />
        </div>

        @if (typing()) {
          <div aria-label="Assistant is typing" class="cog-assistant-message__typing">
            <span></span><span></span><span></span>
          </div>
        }

        @if (sources() > 0) {
          <button class="cog-assistant-message__sources" type="button">
            <cog-icon name="quote" [size]="14" tone="link" />
            <span>{{ sources() }} source{{ sources() === 1 ? '' : 's' }}</span>
          </button>
        }
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-assistant-message {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--cog-space-150);
        align-items: start;
      }

      .cog-assistant-message__avatar {
        display: inline-flex;
        width: 30px;
        height: 30px;
        align-items: center;
        justify-content: center;
        border-radius: var(--cog-radius-pill);
        background: var(--cog-brand);
        color: var(--cog-on-brand);
      }

      .cog-assistant-message__content {
        display: grid;
        gap: var(--cog-space-100);
        min-width: 0;
        max-width: 100%;
      }

      @media (min-width: 768px) {
        .cog-assistant-message__content {
          max-width: min(88%, 620px);
        }
      }

      .cog-assistant-message__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cog-space-100);
      }

      .cog-assistant-message__heading {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cog-space-100);
      }

      .cog-assistant-message__model {
        color: var(--cog-text);
        font-size: var(--cog-fs-body);
        font-weight: var(--cog-fw-semibold);
        line-height: var(--cog-lh-body);
      }

      .cog-assistant-message__time {
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-caption);
        line-height: var(--cog-lh-caption);
      }

      .cog-assistant-message__actions {
        display: flex;
        gap: var(--cog-space-050);
        opacity: 0;
        transition: opacity var(--cog-dur-fast) var(--cog-ease-standard);
      }

      .cog-assistant-message:hover .cog-assistant-message__actions,
      .cog-assistant-message:focus-within .cog-assistant-message__actions {
        opacity: 1;
      }

      .cog-assistant-message__body {
        color: var(--cog-text);
        font-size: var(--cog-fs-body-lg);
        line-height: var(--cog-lh-body-lg);
      }

      .cog-assistant-message__typing {
        display: inline-flex;
        gap: 4px;
        color: var(--cog-text-subtlest);
      }

      .cog-assistant-message__typing span {
        width: 6px;
        height: 6px;
        border-radius: var(--cog-radius-pill);
        background: currentColor;
        animation: cog-assistant-message-blink 1s infinite;
      }

      .cog-assistant-message__typing span:nth-child(2) {
        animation-delay: 120ms;
      }

      .cog-assistant-message__typing span:nth-child(3) {
        animation-delay: 240ms;
      }

      .cog-assistant-message__sources {
        display: inline-flex;
        width: fit-content;
        align-items: center;
        gap: var(--cog-space-050);
        border: 0;
        background: transparent;
        color: var(--cog-link);
        cursor: pointer;
        padding: 0;
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);

        &:hover {
          text-decoration: underline;
        }
      }

      @keyframes cog-assistant-message-blink {
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
export class CognosAssistantMessageComponent {
  readonly model = input('Cognos');
  readonly encrypted = input(true);
  readonly time = input('');
  readonly sources = input(0);
  readonly typing = input(false);
  readonly showActions = input(true);
}
