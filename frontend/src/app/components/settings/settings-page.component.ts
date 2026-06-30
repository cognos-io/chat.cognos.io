import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosPageHeaderComponent } from '@cognos/ui-angular';

/**
 * SettingsPageComponent is the shared shell for every settings page under
 * /account/*. It renders the standard `cog-page-header` (Settings > <section>
 * breadcrumbs + title + optional subtitle) and the column layout that stacks
 * cards (max-width + vertical gap), so individual pages only provide their
 * content (typically a sequence of `<cog-card>` blocks). Use this for any new
 * settings page.
 */
@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [CognosPageHeaderComponent, TranslocoModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <cog-page-header
        [breadcrumbs]="[
          { label: t('account.breadcrumbs.settings') },
          { label: heading(), current: true },
        ]"
        [title]="heading()"
        [subtitle]="subtitle()"
      />
      <ng-content />
    </ng-container>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-200);
      max-width: 920px;
    }
  `,
})
export class SettingsPageComponent {
  /** Page title — used as both the `<h1>` and the current breadcrumb label. */
  readonly heading = input.required<string>();
  /** Optional one-line description shown under the title. */
  readonly subtitle = input('');
}
