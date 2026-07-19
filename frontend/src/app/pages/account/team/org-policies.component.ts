import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  linkedSignal,
  output,
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
  CognosTextFieldComponent,
  CognosToastService,
  CognosToggleComponent,
} from '@cognos/ui-angular';

import {
  OrgPolicyUpdateRequest,
  OrgPrivacyTierCeiling,
  OrganisationRecord,
} from '@app/interfaces/organisation';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';

/** The selectable ceilings, in strictness order; '' means no ceiling. */
const TIER_VALUES: readonly OrgPrivacyTierCeiling[] = ['', 'ch_only', 'eu', 'global'];

let nextMfaToggleId = 0;

// OrgPoliciesComponent is the Organisation policies surface (spec §6,
// Phase 2): the privacy-tier ceiling, the retention default and the MFA
// requirement that apply to everyone working in the Organisation's Projects.
// Owners/Admins get the editable form; plain Members get a compact read-only
// summary (policies are visible to every member — they describe rules that
// apply to them). One Save button per the house pattern (org-general); only
// the fields that actually changed are PATCHed.
@Component({
  selector: 'app-org-policies',
  standalone: true,
  imports: [
    CognosButtonComponent,
    CognosCalloutComponent,
    CognosCardComponent,
    CognosChoiceChipGroupComponent,
    CognosFieldComponent,
    CognosTextFieldComponent,
    CognosToggleComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      @if (editable()) {
        <cog-card
          [heading]="t('team.policies.heading')"
          [subtitle]="t('team.policies.subtitle')"
        >
          <form class="team-card__fields" (submit)="save($event)">
            <cog-field
              [label]="t('team.policies.privacyLabel')"
              [hint]="t('team.policies.privacyHint')"
            >
              <cog-choice-chip-group
                [options]="tierOptions()"
                [value]="tier()"
                [ariaLabel]="t('team.policies.privacyLabel')"
                (valueChange)="setTier($event)"
              />
            </cog-field>

            <cog-field
              [label]="t('team.policies.retentionLabel')"
              [hint]="t('team.policies.retentionHint')"
              [error]="retentionValid() ? '' : t('team.policies.retentionError')"
            >
              <cog-text-field
                inputmode="numeric"
                autocomplete="off"
                [value]="retention()"
                (valueChange)="retention.set($event)"
                [ariaLabel]="t('team.policies.retentionLabel')"
              />
            </cog-field>

            <div class="org-policies__mfa">
              <div class="org-policies__mfa-row">
                <label class="org-policies__mfa-label" [for]="mfaToggleId">{{
                  t('team.policies.mfaLabel')
                }}</label>
                <cog-toggle
                  [inputId]="mfaToggleId"
                  [checked]="mfa()"
                  [label]="t('team.policies.mfaLabel')"
                  (checkedChange)="mfa.set($event)"
                />
              </div>
              <p class="org-policies__mfa-hint">{{ t('team.policies.mfaHint') }}</p>
              @if (mfaWarning()) {
                <cog-callout tone="warning" icon="triangle-alert">
                  {{ t('team.policies.mfaWarning') }}
                </cog-callout>
              }
            </div>
          </form>
          <cog-button
            card-actions
            appearance="primary"
            type="button"
            [disabled]="savePending() || !canSave()"
            (click)="save()"
            >{{ t('team.policies.save') }}</cog-button
          >
        </cog-card>
      } @else {
        <!-- Read-only view for role 'member': the rules that apply to them. -->
        <dl
          class="org-policies__summary"
          [attr.aria-label]="t('team.policies.heading')"
        >
          <div class="org-policies__summary-row">
            <dt>{{ t('team.policies.summaryPrivacy') }}</dt>
            <dd>{{ tierName(org().policy_privacy_tier) }}</dd>
          </div>
          <div class="org-policies__summary-row">
            <dt>{{ t('team.policies.summaryRetention') }}</dt>
            <dd>{{ retentionSummary() }}</dd>
          </div>
          <div class="org-policies__summary-row">
            <dt>{{ t('team.policies.summaryMfa') }}</dt>
            <dd>
              {{
                org().policy_mfa_required
                  ? t('team.policies.mfaRequired')
                  : t('team.policies.mfaNotRequired')
              }}
            </dd>
          </div>
        </dl>
      }
    </ng-container>
  `,
  styles: `
    .team-card__fields {
      display: grid;
      gap: var(--cog-space-200);
      margin-top: var(--cog-space-100);
      min-width: 0;
    }

    .org-policies__mfa {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-100);
    }

    .org-policies__mfa-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--cog-space-100);
    }

    .org-policies__mfa-label {
      color: var(--cog-text);
      font-size: var(--cog-fs-body-sm);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-body-sm);
      cursor: pointer;
    }

    .org-policies__mfa-hint {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      line-height: var(--cog-lh-body-sm);
      text-wrap: pretty;
    }

    .org-policies__summary {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-050);
      margin: 0;
    }

    .org-policies__summary-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--cog-space-100);
    }

    .org-policies__summary-row dt {
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-small);
    }

    .org-policies__summary-row dd {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-small);
      text-align: end;
    }
  `,
})
export class OrgPoliciesComponent {
  private readonly _api = inject(CognosApiService);
  private readonly _toast = inject(CognosToastService);
  private readonly _errors = inject(ErrorService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _destroyRef = inject(DestroyRef);

  /** The Organisation whose policies are shown (any active member). */
  readonly org = input.required<OrganisationRecord>();

  /** Emits the updated record after a successful save. */
  readonly updated = output<OrganisationRecord>();

  protected readonly mfaToggleId = `org-policies-mfa-${++nextMfaToggleId}`;

  /** Members get the read-only summary; Owners/Admins the editable form. */
  protected readonly editable = computed(() => this.org().role !== 'member');

  // Editable copies of the three policies; reset whenever the org changes
  // (including after a successful save round-trips the server record).
  protected readonly tier = linkedSignal<string>(() => this.org().policy_privacy_tier);
  protected readonly retention = linkedSignal(() =>
    String(this.org().policy_retention_days),
  );
  protected readonly mfa = linkedSignal(() => this.org().policy_mfa_required);

  protected readonly savePending = signal(false);

  /** Retention must be a whole number of days, 0 (= none) or more. */
  protected readonly retentionValid = computed(() =>
    /^\d+$/.test(this.retention().trim()),
  );

  private readonly _retentionDays = computed(() =>
    this.retentionValid() ? parseInt(this.retention().trim(), 10) : null,
  );

  /** Show the immediate-lockout warning before MFA is switched on. */
  protected readonly mfaWarning = computed(
    () => this.mfa() && !this.org().policy_mfa_required,
  );

  /** The partial PATCH body — only the fields that actually changed. */
  private readonly _changes = computed<OrgPolicyUpdateRequest>(() => {
    const org = this.org();
    const changes: OrgPolicyUpdateRequest = {};
    if (this.tier() !== org.policy_privacy_tier) {
      changes.policy_privacy_tier = this.tier() as OrgPrivacyTierCeiling;
    }
    const days = this._retentionDays();
    if (days !== null && days !== org.policy_retention_days) {
      changes.policy_retention_days = days;
    }
    if (this.mfa() !== org.policy_mfa_required) {
      changes.policy_mfa_required = this.mfa();
    }
    return changes;
  });

  protected canSave(): boolean {
    return this.retentionValid() && Object.keys(this._changes()).length > 0;
  }

  protected tierOptions(): { value: string; label: string }[] {
    return TIER_VALUES.map((value) => ({
      value,
      label:
        value === ''
          ? this._transloco.translate('team.policies.privacyNone')
          : this._transloco.translate(`team.policies.tiers.${value}`),
    }));
  }

  protected tierName(tier: OrgPrivacyTierCeiling): string {
    return tier === ''
      ? this._transloco.translate('team.policies.privacyNone')
      : this._transloco.translate(`team.policies.tiers.${tier}`);
  }

  protected retentionSummary(): string {
    const days = this.org().policy_retention_days;
    if (days === 0) {
      return this._transloco.translate('team.policies.retentionNone');
    }
    if (days === 1) {
      return this._transloco.translate('team.policies.retentionDaysOne');
    }
    return this._transloco.translate('team.policies.retentionDaysMany', {
      count: days,
    });
  }

  protected setTier(value: string | null): void {
    if (value !== null && TIER_VALUES.includes(value as OrgPrivacyTierCeiling)) {
      this.tier.set(value);
    }
  }

  protected save(event?: Event): void {
    event?.preventDefault();
    if (this.savePending() || !this.canSave()) {
      return;
    }
    this.savePending.set(true);
    this._api
      .updateOrgPolicies(this.org().id, this._changes())
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (record) => {
          this.savePending.set(false);
          // Announced via the toast host's aria-live status region.
          this._toast.notify({
            title: this._transloco.translate('team.policies.saved'),
            tone: 'success',
          });
          this.updated.emit(record);
        },
        error: () => {
          this.savePending.set(false);
          this._errors.alert(this._transloco.translate('team.policies.saveError'));
        },
      });
  }
}
