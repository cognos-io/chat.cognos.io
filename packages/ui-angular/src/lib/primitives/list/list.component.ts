import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * CognosListComponent (`cog-list`) is a borderless, divided vertical list: rows
 * are separated by a single hairline, with no surrounding box. It pairs with
 * `cog-list-item`. Use it for any stacked list of records — model catalogues,
 * trusted devices, members, etc. — so they all read the same way.
 *
 *   <cog-list>
 *     <cog-list-item>
 *       <div>Primary content</div>
 *       <button>Action</button>
 *     </cog-list-item>
 *   </cog-list>
 */
@Component({
  selector: 'cog-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'list' },
  template: `<ng-content />`,
  styles: [
    `
      :host {
        display: grid;
      }
    `,
  ],
})
export class CognosListComponent {}
