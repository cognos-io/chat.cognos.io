import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosCardComponent } from '@cognos/ui-angular';

import { SettingsPageComponent } from '@app/components/settings/settings-page.component';

// SettingsPlaceholderComponent renders a "coming soon" settings page using the
// shared settings shell, so flagged-off sections look like the real ones. The
// page title comes from route data.
@Component({
  selector: 'app-settings-placeholder',
  standalone: true,
  imports: [SettingsPageComponent, CognosCardComponent, TranslocoModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <app-settings-page [heading]="title">
        <cog-card>
          <p class="placeholder__text">{{ t('settings.placeholder.comingSoon') }}</p>
        </cog-card>
      </app-settings-page>
    </ng-container>
  `,
  styles: `
    .placeholder__text {
      margin: 0;
      color: var(--cog-text-subtle);
    }
  `,
})
export class SettingsPlaceholderComponent {
  private readonly _route = inject(ActivatedRoute);
  protected readonly title =
    (this._route.snapshot.data['title'] as string | undefined) ?? 'Settings';
}
