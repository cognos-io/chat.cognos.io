import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosCalloutComponent,
  CognosDialogActionsComponent,
  CognosDialogSurfaceComponent,
} from '@cognos/ui-angular';

export interface DissolveOrganisationDialogData {
  orgName: string;
}

// Security-sensitive confirmation for Organisation dissolution (spec §8.3).
// CDK Dialog supplies the focus trap, Escape handling and focus restoration;
// the explicit checkbox prevents an accidental destructive click.
@Component({
  selector: 'app-dissolve-organisation-dialog',
  standalone: true,
  imports: [
    CognosButtonComponent,
    CognosCalloutComponent,
    CognosDialogActionsComponent,
    CognosDialogSurfaceComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-dialog-surface
      *transloco="let t"
      [title]="t('team.dissolve.title', { org: data.orgName })"
      [closeLabel]="t('common.close')"
      [footer]="true"
      (close)="close()"
    >
      <div class="dissolve-dialog__body">
        <cog-callout tone="danger" icon="triangle-alert">
          {{ t('team.dissolve.projectsAndMembers') }}
        </cog-callout>
        <p class="dissolve-dialog__text">{{ t('team.dissolve.subscription') }}</p>
        <cog-callout tone="info" icon="shield-check">
          {{ t('team.dissolve.personalUntouched') }}
        </cog-callout>
        <label class="dissolve-dialog__acknowledgement">
          <input
            type="checkbox"
            [checked]="acknowledged()"
            (change)="setAcknowledged($event)"
          />
          <span>{{ t('team.dissolve.acknowledgement') }}</span>
        </label>
      </div>

      <cog-dialog-actions cogDialogFooter>
        <cog-button appearance="subtle" (click)="close()">{{
          t('team.dissolve.cancel')
        }}</cog-button>
        <cog-button
          appearance="danger"
          [disabled]="!acknowledged()"
          (click)="confirm()"
          >{{ t('team.dissolve.confirm') }}</cog-button
        >
      </cog-dialog-actions>
    </cog-dialog-surface>
  `,
  styles: `
    .dissolve-dialog__body {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-150);
      max-width: 48ch;
    }

    .dissolve-dialog__text {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
      text-wrap: pretty;
    }

    .dissolve-dialog__acknowledgement {
      display: flex;
      min-height: 40px;
      align-items: start;
      gap: var(--cog-space-100);
      border: var(--cog-border-width) solid var(--cog-danger-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface-raised);
      padding: var(--cog-space-150);
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
      cursor: pointer;
      text-wrap: pretty;
    }

    .dissolve-dialog__acknowledgement input {
      margin: var(--cog-space-025) 0 0;
      accent-color: var(--cog-danger);
    }

    .dissolve-dialog__acknowledgement:focus-within {
      outline: 2px solid var(--cog-brand);
      outline-offset: 2px;
    }
  `,
})
export class DissolveOrganisationDialogComponent {
  private readonly _dialogRef = inject(DialogRef<boolean>);

  readonly data: DissolveOrganisationDialogData = inject(DIALOG_DATA);
  readonly acknowledged = signal(false);

  setAcknowledged(event: Event): void {
    this.acknowledged.set((event.target as HTMLInputElement).checked);
  }

  close(): void {
    this._dialogRef.close(false);
  }

  confirm(): void {
    if (this.acknowledged()) {
      this._dialogRef.close(true);
    }
  }
}
