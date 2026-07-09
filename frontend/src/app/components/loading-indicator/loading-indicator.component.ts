import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';

@Component({
  selector: 'app-loading-indicator',
  standalone: true,
  imports: [],
  template: `
    <div class="loading-indicator" [attr.aria-label]="loadingLabel" role="status">
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
      width: var(--cog-space-100);
      height: var(--cog-space-100);
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
        transform: translateY(calc(-1 * var(--cog-space-025)));
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadingIndicatorComponent {
  private readonly _transloco = inject(TranslocoService);
  protected readonly loadingLabel = this._transloco.translate('common.loading');
}
