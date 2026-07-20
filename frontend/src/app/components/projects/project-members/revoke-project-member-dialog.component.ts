import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosCalloutComponent,
  CognosDialogActionsComponent,
  CognosDialogSurfaceComponent,
} from '@cognos/ui-angular';

/** Data passed to the revoke-project-member confirmation dialog. */
export interface RevokeProjectMemberDialogData {
  memberName: string;
  projectName: string;
}

// RevokeProjectMemberDialogComponent confirms removing a participant from an
// org-owned Project. It is honest about the crypto model (spec §9.2):
// removal is forward-only — the person keeps whatever they already saw — so
// the Project key is rotated immediately afterwards to protect future
// content, and the person's own Account and personal chats are untouched.
@Component({
  selector: 'app-revoke-project-member-dialog',
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
      [title]="t('projects.members.revokeTitle', { name: data.memberName })"
      [closeLabel]="t('common.close')"
      [footer]="true"
      (close)="close()"
    >
      <div class="revoke-member__body">
        <p class="revoke-member__text">
          {{
            t('projects.members.revokeBody', {
              name: data.memberName,
              project: data.projectName,
            })
          }}
        </p>
        <cog-callout tone="info" icon="key-round">
          {{ t('projects.members.revokeForwardOnly') }}
        </cog-callout>
        <p class="revoke-member__text">
          {{ t('projects.members.revokeNote', { name: data.memberName }) }}
        </p>
      </div>

      <cog-dialog-actions cogDialogFooter>
        <cog-button appearance="subtle" (click)="close()">{{
          t('projects.cancel')
        }}</cog-button>
        <cog-button appearance="danger" (click)="confirm()">{{
          t('projects.members.revokeConfirm')
        }}</cog-button>
      </cog-dialog-actions>
    </cog-dialog-surface>
  `,
  styles: `
    .revoke-member__body {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-100);
      max-width: 44ch;
    }

    .revoke-member__text {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }
  `,
})
export class RevokeProjectMemberDialogComponent {
  private readonly _dialogRef = inject(DialogRef<boolean>);

  readonly data: RevokeProjectMemberDialogData = inject(DIALOG_DATA);

  close(): void {
    this._dialogRef.close(false);
  }

  confirm(): void {
    this._dialogRef.close(true);
  }
}
