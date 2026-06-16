import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { CognosLozengeComponent } from '@cognos/ui-angular';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { BillingService } from '@app/services/billing.service';

// SidebarBrandComponent is the single source of truth for the sidebar header —
// the centred Cognos logo plus any badge — shared by the chat shell and the
// settings shell so the two can never drift apart. Any badge (currently the
// trial lozenge) is rendered here, so it shows identically on every screen that
// uses this component and the header layout stays the same everywhere.
@Component({
  selector: 'app-sidebar-brand',
  standalone: true,
  imports: [CognosLogoComponent, CognosLozengeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sidebar-brand">
      <app-cognos-logo class="sidebar-brand__logo" palette="dark" />
      @if (billing.isTrial()) {
        <cog-lozenge tone="neutral">Trial</cog-lozenge>
      }
    </div>
  `,
  styles: `
    .sidebar-brand {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--cog-space-100);
    }

    .sidebar-brand__logo {
      display: block;
      height: 24px;
    }
  `,
})
export class SidebarBrandComponent {
  protected readonly billing = inject(BillingService);
}
