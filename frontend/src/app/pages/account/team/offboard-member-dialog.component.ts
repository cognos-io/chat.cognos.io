import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosCalloutComponent,
  CognosDialogActionsComponent,
  CognosDialogSurfaceComponent,
} from '@cognos/ui-angular';

import { BILLING_PRICES } from '@app/billing/pricing';

/** Data passed to the offboard confirmation dialog. */
export interface OffboardMemberDialogData {
  memberName: string;
  orgName: string;
}

// OffboardMemberDialogComponent is the confirm step before removing a member
// (spec §8.2). It must do three things in plain language: state the immediate
// consequence (future org content is cut off), explicitly reassure that the
// person's personal Account is untouched, and warn that the Seat stays billed
// until the next cycle. Opened via CDK Dialog (focus-trapped); closes with a
// boolean.
@Component({
  selector: 'app-offboard-member-dialog',
  standalone: true,
  imports: [
    CognosDialogSurfaceComponent,
    CognosDialogActionsComponent,
    CognosButtonComponent,
    CognosCalloutComponent,
    TranslocoModule,
  ],
  template: `
    <cog-dialog-surface
      *transloco="let t"
      [title]="t('team.offboard.title', { name: data.memberName })"
      [closeLabel]="t('common.close')"
      [footer]="true"
      (close)="close()"
    >
      <div class="offboard-dialog__body">
        <p class="offboard-dialog__text">
          {{ t('team.offboard.immediate', { org: data.orgName }) }}
        </p>
        <cog-callout tone="info" icon="shield-check">
          {{ t('team.offboard.personalUntouched') }}
        </cog-callout>
        <p class="offboard-dialog__text">
          {{ t('team.offboard.seat', { minSeats: minSeats }) }}
        </p>
      </div>

      <cog-dialog-actions cogDialogFooter>
        <cog-button appearance="subtle" (click)="close()">{{
          t('team.offboard.cancel')
        }}</cog-button>
        <cog-button appearance="danger" (click)="confirm()">{{
          t('team.offboard.confirm')
        }}</cog-button>
      </cog-dialog-actions>
    </cog-dialog-surface>
  `,
  styles: `
    .offboard-dialog__body {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-100);
      max-width: 44ch;
    }

    .offboard-dialog__text {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OffboardMemberDialogComponent {
  private readonly _dialogRef = inject(DialogRef<boolean>);

  readonly data: OffboardMemberDialogData = inject(DIALOG_DATA);
  protected readonly minSeats = BILLING_PRICES.orgSeatMinimum;

  close(): void {
    this._dialogRef.close(false);
  }

  confirm(): void {
    this._dialogRef.close(true);
  }
}
