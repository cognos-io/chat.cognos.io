import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type CognosCardTone = 'default' | 'danger';

/**
 * CognosCardComponent (`cog-card`) is the standard settings/section card: a
 * surface with a border, medium radius, padding, an optional heading + subtitle,
 * a body, and a right-aligned actions row. It is the single source of truth for
 * card chrome and typography so every settings page reads identically.
 *
 *   <cog-card [heading]="'Password'" [subtitle]="'…'">
 *     ...body...
 *     <div card-actions><cog-button>Change password</cog-button></div>
 *   </cog-card>
 *
 * Slots:
 *   [card-heading-actions] — trailing control on the heading row (badge, toggle).
 *   [card-actions]         — bottom-right action buttons.
 *
 * Cards with a bespoke header (no fixed heading/subtitle) can omit the inputs
 * and project their own markup into the default slot.
 */
@Component({
  selector: 'cog-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cog-card" [class.cog-card--danger]="tone() === 'danger'">
      @if (heading() || subtitle()) {
        <div class="cog-card__head">
          <div class="cog-card__head-text">
            @if (heading()) {
              <h2 class="cog-card__title">{{ heading() }}</h2>
            }
            @if (subtitle()) {
              <p class="cog-card__subtitle">{{ subtitle() }}</p>
            }
          </div>
          <div class="cog-card__head-actions">
            <ng-content select="[card-heading-actions]" />
          </div>
        </div>
      }

      <ng-content />

      <div class="cog-card__actions">
        <ng-content select="[card-actions]" />
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-card {
        display: grid;
        gap: var(--cog-space-100);
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-md);
        background: var(--cog-surface);
        padding: var(--cog-space-250, 20px);
      }

      /* Danger tone: a tinted surface + red border to flag destructive actions. */
      .cog-card--danger {
        border-color: var(--cog-danger);
        background: var(--cog-loz-red-bg);
      }

      .cog-card__head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--cog-space-150);
      }

      .cog-card__head-text {
        display: grid;
        gap: var(--cog-space-050);
        min-width: 0;
      }

      .cog-card__head-actions {
        display: flex;
        flex: none;
        align-items: center;
        gap: var(--cog-space-100);
      }

      .cog-card__head-actions:empty {
        display: none;
      }

      .cog-card__title {
        margin: 0;
        color: var(--cog-text);
        font-size: var(--cog-fs-h-sm);
        font-weight: var(--cog-fw-semibold);
      }

      .cog-card--danger .cog-card__title {
        color: var(--cog-danger-text);
      }

      .cog-card__subtitle {
        margin: 0;
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body);
        line-height: var(--cog-lh-body);
        text-wrap: pretty;
      }

      .cog-card__actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--cog-space-100);
        margin-top: var(--cog-space-100);
      }

      .cog-card__actions:empty {
        display: none;
        margin: 0;
      }
    `,
  ],
})
export class CognosCardComponent {
  readonly heading = input('');
  readonly subtitle = input('');
  readonly tone = input<CognosCardTone>('default');
}
