import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type CognosLozengeTone = 'neutral' | 'blue' | 'green' | 'purple' | 'red';

@Component({
  selector: 'cog-lozenge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span [class]="lozengeClass()">
      <ng-content />
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      .cog-lozenge {
        display: inline-flex;
        min-height: 18px;
        align-items: center;
        border-radius: var(--cog-radius-xs);
        padding: var(--cog-space-025) var(--cog-space-050);
        font-size: var(--cog-fs-lozenge);
        font-weight: var(--cog-fw-lozenge);
        line-height: var(--cog-lh-lozenge);
        letter-spacing: var(--cog-ls-lozenge);
        text-transform: var(--cog-tt-lozenge);
        white-space: nowrap;

        &.cog-lozenge--neutral {
          background: var(--cog-loz-neutral-bg);
          color: var(--cog-loz-neutral-fg);
        }

        &.cog-lozenge--blue {
          background: var(--cog-loz-blue-bg);
          color: var(--cog-loz-blue-fg);
        }

        &.cog-lozenge--green {
          background: var(--cog-loz-green-bg);
          color: var(--cog-loz-green-fg);
        }

        &.cog-lozenge--purple {
          background: var(--cog-loz-purple-bg);
          color: var(--cog-loz-purple-fg);
        }

        &.cog-lozenge--red {
          background: var(--cog-loz-red-bg);
          color: var(--cog-loz-red-fg);
        }
      }
    `,
  ],
})
export class CognosLozengeComponent {
  readonly tone = input<CognosLozengeTone>('neutral');

  protected readonly lozengeClass = computed(
    () => `cog-lozenge cog-lozenge--${this.tone()}`,
  );
}
