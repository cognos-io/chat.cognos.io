import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-loading-indicator',
  standalone: true,
  imports: [],
  template: `
    <div class="loading-indicator" aria-label="Loading" role="status">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      justify-content: center;
      padding: var(--cog-space-200);
    }

    .loading-indicator {
      display: inline-flex;
      gap: var(--cog-space-050);
      color: var(--cog-text-subtlest);
    }

    .loading-indicator span {
      width: 8px;
      height: 8px;
      border-radius: var(--cog-radius-pill);
      background: currentColor;
      animation: loading-indicator-bounce 1s infinite var(--cog-ease-standard);
    }

    .loading-indicator span:nth-child(2) {
      animation-delay: 120ms;
    }

    .loading-indicator span:nth-child(3) {
      animation-delay: 240ms;
    }

    @keyframes loading-indicator-bounce {
      0%,
      80%,
      100% {
        opacity: 0.35;
        transform: translateY(0);
      }

      40% {
        opacity: 1;
        transform: translateY(-2px);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadingIndicatorComponent {}
