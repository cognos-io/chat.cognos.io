import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosCalloutComponent,
  CognosCardComponent,
  CognosChoiceChipGroupComponent,
  CognosFieldComponent,
  CognosLozengeComponent,
  CognosSegmentedControlComponent,
  CognosTextFieldComponent,
} from '@cognos/ui-angular';

import { BILLING_PRICES } from '@app/billing/pricing';
import { SettingsPageComponent } from '@app/components/settings/settings-page.component';
import { OrganisationRecord } from '@app/interfaces/organisation';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';

import { OrgBillingComponent } from './org-billing.component';
import { OrgGeneralComponent } from './org-general.component';
import { OrgInvitesComponent } from './org-invites.component';
import { OrgMembersComponent } from './org-members.component';
import { OrgPoliciesComponent } from './org-policies.component';

type AdminTab = 'members' | 'invites' | 'billing' | 'policies' | 'settings';

// TeamSettingsComponent is the /account/team page (behind the `team` feature
// flag). Three shapes, by what the signed-in Account holds:
// - no Organisations → the create flow: name → POST /orgs → Paddle checkout
//   (Owner takes the first Seat; no trial — spec §5.1/§7.1);
// - only Member-role Organisations → a read-only list (Members have no
//   administrative surface, spec §5.3) plus the create flow;
// - Owner/Admin Organisations → the admin view: Members, Invites, Billing &
//   usage, Settings.
// Designed so Sophie finishes creation and her first invite in one sitting —
// no SSO, no IT step, nothing before Seat 1 (persona PER-005).
@Component({
  selector: 'app-team-settings',
  standalone: true,
  imports: [
    CognosButtonComponent,
    CognosCalloutComponent,
    CognosCardComponent,
    CognosChoiceChipGroupComponent,
    CognosFieldComponent,
    CognosLozengeComponent,
    CognosSegmentedControlComponent,
    CognosTextFieldComponent,
    OrgBillingComponent,
    OrgGeneralComponent,
    OrgInvitesComponent,
    OrgMembersComponent,
    OrgPoliciesComponent,
    SettingsPageComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-settings-page
      *transloco="let t"
      [heading]="t('team.title')"
      [subtitle]="t('team.subtitle')"
    >
      @if (loading()) {
        <p class="team-settings__state" role="status">{{ t('team.loading') }}</p>
      } @else if (error()) {
        <cog-callout tone="danger" icon="triangle-alert">
          {{ t('team.loadError') }}
        </cog-callout>
        <div>
          <cog-button appearance="default" (click)="load()">{{
            t('team.retry')
          }}</cog-button>
        </div>
      } @else if (createdOrg(); as created) {
        <!-- Step 2 of creation: the org exists but has no billing until
             checkout completes — it can't invite or hold Projects yet. -->
        <cog-card
          [heading]="t('team.create.checkoutHeading', { name: created.name })"
          [subtitle]="t('team.create.checkoutIntro', { price: seatPrice })"
        >
          <cog-callout tone="info" icon="info">
            {{ t('team.create.checkoutNote') }}
          </cog-callout>
          <cog-button
            card-actions
            appearance="primary"
            icon="credit-card"
            [disabled]="checkoutPending()"
            (click)="startCheckout(created.id)"
            >{{ t('team.create.checkoutCta') }}</cog-button
          >
        </cog-card>
      } @else if (adminOrgs().length > 0) {
        @if (adminOrgs().length > 1) {
          <cog-choice-chip-group
            [options]="orgOptions()"
            [value]="selectedOrg()?.id ?? null"
            [ariaLabel]="t('team.orgPickerLabel')"
            (valueChange)="selectOrg($event)"
          />
        }

        @if (selectedOrg(); as org) {
          <cog-segmented-control
            [options]="tabOptions(t)"
            [value]="tab()"
            [ariaLabel]="t('team.tabs.label')"
            (select)="selectTab($event)"
          />

          @switch (tab()) {
            @case ('invites') {
              <app-org-invites [org]="org" />
            }
            @case ('billing') {
              <app-org-billing [org]="org" />
            }
            @case ('policies') {
              <app-org-policies [org]="org" (updated)="onOrgUpdated($event)" />
            }
            @case ('settings') {
              <app-org-general [org]="org" (renamed)="onRenamed($event)" />
            }
            @default {
              <app-org-members [org]="org" />
            }
          }
        }
      } @else {
        @if (memberOrgs().length > 0) {
          <cog-card
            [heading]="t('team.memberOnly.heading')"
            [subtitle]="t('team.memberOnly.body')"
          >
            <ul class="team-settings__member-orgs">
              @for (org of memberOrgs(); track org.id) {
                <li class="team-settings__member-org">
                  <div class="team-settings__member-org-head">
                    <span>{{ org.name }}</span>
                    <cog-lozenge tone="neutral">{{
                      t('team.roles.' + org.role)
                    }}</cog-lozenge>
                  </div>
                  <!-- The org's policies, read-only: the rules that apply to
                       the member's work in its Projects (spec §6). -->
                  <app-org-policies [org]="org" />
                </li>
              }
            </ul>
          </cog-card>
        }

        <cog-card
          [heading]="t('team.create.heading')"
          [subtitle]="t('team.create.intro')"
        >
          <p class="team-settings__pricing">
            {{ t('team.create.pricing', { price: seatPrice }) }}
          </p>
          <form class="team-settings__form" (submit)="create($event)">
            <cog-field [label]="t('team.create.nameLabel')">
              <cog-text-field
                [placeholder]="t('team.create.namePlaceholder')"
                [value]="name()"
                (valueChange)="name.set($event)"
                [ariaLabel]="t('team.create.nameLabel')"
              />
            </cog-field>
            <div>
              <cog-button
                appearance="primary"
                type="submit"
                [disabled]="createPending() || !name().trim()"
                >{{ t('team.create.submit') }}</cog-button
              >
            </div>
          </form>
        </cog-card>
      }
    </app-settings-page>
  `,
  styles: `
    .team-settings__state {
      margin: 0;
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-body);
    }

    .team-settings__pricing {
      margin: 0 0 var(--cog-space-150);
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
    }

    .team-settings__form {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-150);
      max-width: 480px;
    }

    .team-settings__member-orgs {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      gap: var(--cog-space-200);
      list-style: none;
    }

    .team-settings__member-org {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-100);
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
    }

    .team-settings__member-org-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--cog-space-100);
    }
  `,
})
export class TeamSettingsComponent {
  private readonly _api = inject(CognosApiService);
  private readonly _errors = inject(ErrorService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly seatPrice = BILLING_PRICES.orgSeatMonthly;

  protected readonly orgs = signal<OrganisationRecord[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  // Create flow.
  protected readonly name = signal('');
  protected readonly createPending = signal(false);
  // Set right after POST /orgs succeeds: the org awaiting its first checkout.
  protected readonly createdOrg = signal<OrganisationRecord | null>(null);
  protected readonly checkoutPending = signal(false);

  // Admin view.
  protected readonly tab = signal<AdminTab>('members');
  private readonly _selectedOrgId = signal<string | null>(null);

  /** Organisations the caller can administer (Owner or Admin, spec §5.3). */
  protected readonly adminOrgs = computed(() =>
    this.orgs().filter((org) => org.role === 'owner' || org.role === 'admin'),
  );

  /** Organisations where the caller is a plain Member — no admin surface. */
  protected readonly memberOrgs = computed(() =>
    this.orgs().filter((org) => org.role === 'member'),
  );

  protected readonly selectedOrg = computed<OrganisationRecord | null>(() => {
    const admin = this.adminOrgs();
    return admin.find((org) => org.id === this._selectedOrgId()) ?? admin[0] ?? null;
  });

  protected readonly orgOptions = computed(() =>
    this.adminOrgs().map((org) => ({ value: org.id, label: org.name })),
  );

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(false);
    this._api
      .listOrgs()
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (orgs) => {
          this.orgs.set(orgs);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.error.set(true);
        },
      });
  }

  protected tabOptions(t: (key: string) => string): { value: string; label: string }[] {
    return [
      { value: 'members', label: t('team.tabs.members') },
      { value: 'invites', label: t('team.tabs.invites') },
      { value: 'billing', label: t('team.tabs.billing') },
      { value: 'policies', label: t('team.tabs.policies') },
      { value: 'settings', label: t('team.tabs.settings') },
    ];
  }

  protected selectTab(value: string): void {
    if (
      value === 'members' ||
      value === 'invites' ||
      value === 'billing' ||
      value === 'policies' ||
      value === 'settings'
    ) {
      this.tab.set(value);
    }
  }

  protected selectOrg(orgId: string | null): void {
    if (orgId && this.adminOrgs().some((org) => org.id === orgId)) {
      this._selectedOrgId.set(orgId);
    }
  }

  protected onRenamed(record: OrganisationRecord): void {
    this.orgs.update((orgs) =>
      orgs.map((org) => (org.id === record.id ? { ...org, name: record.name } : org)),
    );
  }

  /** Merge a policy-updated record back into the list (role stays ours). */
  protected onOrgUpdated(record: OrganisationRecord): void {
    this.orgs.update((orgs) =>
      orgs.map((org) =>
        org.id === record.id ? { ...org, ...record, role: org.role } : org,
      ),
    );
  }

  // --- Create → checkout (spec §5.1, §7.1) ---------------------------------

  protected create(event?: Event): void {
    event?.preventDefault();
    const name = this.name().trim();
    if (this.createPending() || !name) {
      return;
    }
    this.createPending.set(true);
    this._api
      .createOrg({ name })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (org) => {
          this.createPending.set(false);
          this.name.set('');
          this.createdOrg.set(org);
        },
        error: () => {
          this.createPending.set(false);
          this._errors.alert(this._transloco.translate('team.create.error'));
        },
      });
  }

  protected startCheckout(orgId: string): void {
    if (this.checkoutPending()) {
      return;
    }
    this.checkoutPending.set(true);
    this._api
      .createOrgCheckout(orgId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          this.checkoutPending.set(false);
          this.redirect(res.checkout_url);
        },
        error: () => {
          this.checkoutPending.set(false);
          this._errors.alert(this._transloco.translate('team.create.checkoutError'));
        },
      });
  }

  // Thin navigation seam so tests can observe the checkout redirect.
  protected redirect(url: string): void {
    window.location.assign(url);
  }
}
