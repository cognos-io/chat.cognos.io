import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * CognosListItemComponent (`cog-list-item`) is one row of a `cog-list`. It lays
 * its content out as a flex row (primary content on the left, trailing actions
 * on the right) and draws the divider beneath every row except the last.
 *
 * Rows with more than two logical groups should wrap their content in two
 * elements (a main block and a trailing block) so the space-between layout
 * still reads correctly.
 */
@Component({
  selector: 'cog-list-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'listitem' },
  template: `<ng-content />`,
  styles: [
    `
      :host {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cog-space-150);
        padding: var(--cog-space-150) 0;
        border-bottom: var(--cog-border-width) solid var(--cog-border);
      }

      :host:last-child {
        border-bottom: 0;
        padding-bottom: 0;
      }
    `,
  ],
})
export class CognosListItemComponent {}
