import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosBreadcrumbsComponent } from '@cognos/ui-angular';

/**
 * SettingsPageComponent is the shared shell for every settings page under
 * /account/*. It owns the consistent page chrome — `Settings > <section>`
 * breadcrumbs, the page title, an optional subtitle, and the column layout that
 * stacks cards (max-width + vertical gap) — so individual pages only provide
 * their content (typically a sequence of `<app-settings-card>` blocks) and never
 * re-implement the header/layout. Use this for any new settings page.
 */
@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [CognosBreadcrumbsComponent, TranslocoModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <header class="settings-page__header">
        <cog-breadcrumbs
          [items]="[
            { label: t('account.breadcrumbs.settings') },
            { label: heading(), current: true },
          ]"
        />
        <h1 class="settings-page__title">{{ heading() }}</h1>
        @if (subtitle()) {
          <p class="settings-page__subtitle">{{ subtitle() }}</p>
        }
      </header>

      <ng-content />
    </ng-container>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-200, 16px);
      max-width: 920px;
    }
    .settings-page__header {
      display: grid;
      gap: var(--cog-space-050);
      margin: var(--cog-space-150) 0 0;
    }
    .settings-page__title {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-h-lg);
      font-weight: var(--cog-fw-h-lg);
    }
    .settings-page__subtitle {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
      text-wrap: pretty;
    }
  `,
})
export class SettingsPageComponent {
  /** Page title — used as both the `<h1>` and the current breadcrumb label. */
  readonly heading = input.required<string>();
  /** Optional one-line description shown under the title. */
  readonly subtitle = input('');
}
