import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosSectionMessageComponent,
} from '@cognos/ui-angular';

import { OrgCompletionBillingRestriction } from '@app/interfaces/billing';
import { OrganisationService } from '@app/services/organisation.service';

// OrgBillingBannerComponent is the in-conversation notice shown when a
// completion in an org-owned Project was refused because the owning
// Organisation's billing is inactive or past due (fail closed, spec §5.8).
//
// Tone rules (persona PER-006): the pause is the Organisation's, never the
// member's fault; the member's draft is kept; the personal workspace keeps
// working; and it NEVER suggests the member's personal balance could cover
// org work. Owners/Admins additionally get the one actionable next step and
// a direct route to the team billing page.
@Component({
  selector: 'app-org-billing-banner',
  standalone: true,
  imports: [CognosSectionMessageComponent, CognosButtonComponent, TranslocoModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <cog-section-message tone="info" icon="credit-card" [title]="title()">
        {{ body() }} {{ t('billing.orgLock.personalUnaffected') }}
        @if (canManage()) {
          {{ adminNext() }}
        } @else {
          {{ t('billing.orgLock.memberNext', { org: orgName() }) }}
        }
        @if (canManage()) {
          <cog-button
            cogSectionMessageAction
            appearance="primary"
            (click)="goToTeamBilling()"
          >
            {{ t('billing.orgLock.openTeamBilling') }}
          </cog-button>
        }
      </cog-section-message>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class OrgBillingBannerComponent {
  private readonly _router = inject(Router);
  private readonly _transloco = inject(TranslocoService);
  private readonly _workspaces = inject(OrganisationService);

  /** The org billing restriction to explain (from BillingService.orgSendBlock). */
  readonly block = input.required<OrgCompletionBillingRestriction>();

  // Prefer the membership record's name (always current); the 402 body's name
  // is the fallback for the unlikely case the membership list is stale.
  protected readonly orgName = computed(
    () =>
      this._workspaces.orgName(this.block().organisationId) ??
      this.block().organisationName ??
      '',
  );

  // Owners/Admins of the paused Organisation see the actionable step; the
  // viewer's role comes from their own membership record.
  protected readonly canManage = computed(() => {
    const role = this._workspaces
      .memberships()
      .find((org) => org.id === this.block().organisationId)?.role;
    return role === 'owner' || role === 'admin';
  });

  protected readonly title = computed(() =>
    this._transloco.translate(
      this.block().code === 'ORG_BILLING_PAST_DUE'
        ? 'billing.orgLock.titlePastDue'
        : 'billing.orgLock.titleInactive',
      { org: this.orgName() },
    ),
  );

  protected readonly body = computed(() =>
    this._transloco.translate(
      this.block().code === 'ORG_BILLING_PAST_DUE'
        ? 'billing.orgLock.bodyPastDue'
        : 'billing.orgLock.bodyInactive',
      { org: this.orgName() },
    ),
  );

  protected readonly adminNext = computed(() =>
    this._transloco.translate(
      this.block().code === 'ORG_BILLING_PAST_DUE'
        ? 'billing.orgLock.adminNextPastDue'
        : 'billing.orgLock.adminNextInactive',
      { org: this.orgName() },
    ),
  );

  protected goToTeamBilling(): void {
    void this._router.navigate(['/account/team']);
  }
}
