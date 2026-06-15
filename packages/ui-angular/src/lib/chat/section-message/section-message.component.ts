import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { CognosIconName } from '@cognos/ui/icons';

import { CognosIconComponent } from '../../icon/icon.component';

export type CognosSectionMessageTone = 'info' | 'success';

@Component({
  selector: 'cog-section-message',
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section [class]="messageClass()">
      <span class="cog-section-message__icon">
        <cog-icon [name]="resolvedIcon()" [size]="18" [tone]="iconTone()" />
      </span>

      <div class="cog-section-message__copy">
        @if (title()) {
          <div class="cog-section-message__title">{{ title() }}</div>
        }

        <div class="cog-section-message__body">
          <ng-content />
        </div>
      </div>

      <div class="cog-section-message__action">
        <ng-content select="[cogSectionMessageAction]" />
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-section-message {
        display: flex;
        align-items: flex-start;
        gap: var(--cog-space-150);
        border-radius: var(--cog-radius-sm);
        padding: 14px;

        &.cog-section-message--info {
          background: var(--cog-info-bg);
          color: var(--cog-info-text);
        }

        &.cog-section-message--success {
          background: var(--cog-success-bg);
          color: var(--cog-success-text);
        }
      }

      .cog-section-message__icon {
        display: inline-flex;
        flex: none;
        align-items: flex-start;
        justify-content: center;
        padding-top: 1px;
      }

      .cog-section-message__copy {
        display: grid;
        gap: var(--cog-space-050);
        min-width: 0;
      }

      .cog-section-message__title {
        font-size: var(--cog-fs-body-sm);
        font-weight: var(--cog-fw-bold);
        line-height: var(--cog-lh-body-sm);
      }

      .cog-section-message__body {
        color: inherit;
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);
      }

      .cog-section-message__copy {
        flex: 1;
      }

      .cog-section-message__action {
        display: flex;
        align-items: center;
        gap: var(--cog-space-100);
        flex: none;
        align-self: center;
      }

      .cog-section-message__action:empty {
        display: none;
      }
    `,
  ],
})
export class CognosSectionMessageComponent {
  readonly tone = input<CognosSectionMessageTone>('info');
  readonly title = input('');
  readonly icon = input<CognosIconName | null>(null);

  protected readonly messageClass = computed(
    () => `cog-section-message cog-section-message--${this.tone()}`,
  );
  protected readonly resolvedIcon = computed<CognosIconName>(
    () => this.icon() ?? (this.tone() === 'success' ? 'shield-check' : 'shield'),
  );
  protected readonly iconTone = computed(() =>
    this.tone() === 'success' ? 'success' : 'brand',
  );
}
