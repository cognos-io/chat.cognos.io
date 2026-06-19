import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosBreadcrumbsComponent } from '@cognos/ui-angular';

// SettingsPlaceholderComponent renders a "coming soon" settings page. The page
// title comes from route data so a single component backs every not-yet-built
// settings section.
@Component({
  selector: 'app-settings-placeholder',
  standalone: true,
  imports: [CognosBreadcrumbsComponent, TranslocoModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <header class="placeholder__header">
        <cog-breadcrumbs
          [items]="[
            { label: 'Cognos' },
            { label: t('settings.title') },
            { label: title, current: true },
          ]"
        />
        <h1 class="placeholder__title">{{ title }}</h1>
      </header>

      <section class="placeholder__card">
        <p>{{ t('settings.placeholder.comingSoon') }}</p>
      </section>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
      max-width: 920px;
    }

    .placeholder__header {
      display: grid;
      gap: var(--cog-space-050);
      margin: var(--cog-space-150) 0 var(--cog-space-250, 20px);
    }

    .placeholder__title {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-h-lg);
      font-weight: var(--cog-fw-h-lg);
    }

    .placeholder__card {
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      padding: var(--cog-space-250, 20px);
      color: var(--cog-text-subtle);
    }

    .placeholder__card p {
      margin: 0;
    }
  `,
})
export class SettingsPlaceholderComponent {
  private readonly _route = inject(ActivatedRoute);
  protected readonly title =
    (this._route.snapshot.data['title'] as string | undefined) ?? 'Settings';
}
