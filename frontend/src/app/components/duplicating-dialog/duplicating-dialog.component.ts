import { ChangeDetectionStrategy, Component } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

/**
 * DuplicatingDialogComponent is the blocking loading state shown while the
 * browser decrypts and re-encrypts a conversation. It is opened with
 * `disableClose: true` so the user can't dismiss it mid-operation, and it warns
 * them not to close or reload the tab (a reload would abandon the in-flight
 * local re-encryption before the request commits). Duration is unbounded, so it
 * shows an indeterminate spinner rather than a progress bar.
 */
@Component({
  selector: 'app-duplicating-dialog',
  standalone: true,
  imports: [TranslocoModule],
  template: `
    <div
      class="duplicating-dialog"
      *transloco="let t"
      role="alertdialog"
      aria-live="assertive"
      [attr.aria-label]="t('chat.copy.loadingTitle')"
    >
      <div class="duplicating-dialog__spinner" aria-hidden="true"></div>
      <h2 class="duplicating-dialog__title">{{ t('chat.copy.loadingTitle') }}</h2>
      <p class="duplicating-dialog__warning">{{ t('chat.copy.loadingWarning') }}</p>
    </div>
  `,
  styles: `
    .duplicating-dialog {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: var(--cog-space-150);
      padding: var(--cog-space-200);
      max-width: 22rem;
    }

    .duplicating-dialog__spinner {
      width: 2rem;
      height: 2rem;
      border-radius: 50%;
      border: 3px solid var(--cog-border, rgba(0, 0, 0, 0.1));
      border-top-color: var(--cog-brand);
      animation: duplicating-spin 0.8s linear infinite;
    }

    .duplicating-dialog__title {
      margin: 0;
      font-size: var(--cog-fs-h4, 1rem);
      font-weight: var(--cog-fw-semibold);
      color: var(--cog-text);
    }

    .duplicating-dialog__warning {
      margin: 0;
      font-size: var(--cog-fs-body-sm, 0.875rem);
      line-height: var(--cog-lh-body);
      color: var(--cog-text-subtle, var(--cog-text-subtlest));
    }

    @keyframes duplicating-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .duplicating-dialog__spinner {
        animation-duration: 2s;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DuplicatingDialogComponent {}
