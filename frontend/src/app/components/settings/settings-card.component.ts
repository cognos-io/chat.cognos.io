import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * SettingsCardComponent is the shared card used inside a settings page. It gives
 * every section the same surface, border, radius, padding, and title/subtitle
 * typography, so pages can't drift apart visually. Compose freely:
 *
 *   <app-settings-card [heading]="t('x.title')" [subtitle]="t('x.subtitle')">
 *     ...body...
 *     <div card-actions>
 *       <cog-button ...>Save</cog-button>
 *     </div>
 *   </app-settings-card>
 *
 * The optional `[card-actions]` slot is right-aligned at the bottom, matching the
 * primary-action placement across the account cards.
 */
@Component({
  selector: 'app-settings-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="settings-card">
      @if (heading()) {
        <h2 class="settings-card__title">{{ heading() }}</h2>
      }
      @if (subtitle()) {
        <p class="settings-card__subtitle">{{ subtitle() }}</p>
      }
      <ng-content />
      <div class="settings-card__actions">
        <ng-content select="[card-actions]" />
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .settings-card {
      display: grid;
      gap: var(--cog-space-100);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      padding: var(--cog-space-250, 20px);
    }
    .settings-card__title {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-h-sm);
      font-weight: var(--cog-fw-semibold);
    }
    .settings-card__subtitle {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
      text-wrap: pretty;
    }
    .settings-card__actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--cog-space-100);
      margin-top: var(--cog-space-100);
    }
    /* No projected actions → collapse the slot so it adds no spacing. */
    .settings-card__actions:empty {
      display: none;
      margin: 0;
    }
  `,
})
export class SettingsCardComponent {
  readonly heading = input('');
  readonly subtitle = input('');
}
