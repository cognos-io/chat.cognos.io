import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosAvatarComponent,
  CognosButtonComponent,
  CognosChoiceChipGroupComponent,
  CognosDialogActionsComponent,
  CognosDialogSurfaceComponent,
  CognosEmptyStateComponent,
} from '@cognos/ui-angular';

import { OrgMemberRecord } from '@app/interfaces/organisation';
import { ProjectRole } from '@app/interfaces/project';

/** Data passed to the add-project-member dialog. */
export interface AddProjectMemberDialogData {
  /** Active org members who are not yet participants of the project. */
  candidates: OrgMemberRecord[];
  projectName: string;
  orgName: string;
}

/** Dialog result: the chosen member + project role, or undefined on cancel. */
export interface AddProjectMemberSelection {
  userId: string;
  role: ProjectRole;
}

// AddProjectMemberDialogComponent picks an active org member to share an
// org-owned Project with, and the project role to grant. Only org members can
// be candidates (enforced server-side too) — sharing never reaches outside
// the Organisation in v1. The member list is a radiogroup for keyboard and
// screen-reader users.
@Component({
  selector: 'app-add-project-member-dialog',
  standalone: true,
  imports: [
    CognosAvatarComponent,
    CognosButtonComponent,
    CognosChoiceChipGroupComponent,
    CognosDialogActionsComponent,
    CognosDialogSurfaceComponent,
    CognosEmptyStateComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-dialog-surface
      *transloco="let t"
      [title]="t('projects.members.addTitle', { project: data.projectName })"
      [closeLabel]="t('common.close')"
      [footer]="true"
      (close)="cancel()"
    >
      <div class="add-member__body">
        <p class="add-member__intro">
          {{ t('projects.members.addIntro', { org: data.orgName }) }}
        </p>

        @if (data.candidates.length === 0) {
          <cog-empty-state
            icon="users"
            [message]="t('projects.members.candidatesEmpty', { org: data.orgName })"
            role="status"
          />
        } @else {
          <fieldset class="add-member__candidates">
            <legend class="add-member__legend">
              {{ t('projects.members.candidateLabel') }}
            </legend>
            @for (candidate of data.candidates; track candidate.user_id) {
              <label class="add-member__candidate">
                <input
                  class="add-member__radio"
                  type="radio"
                  name="project-member-candidate"
                  [value]="candidate.user_id"
                  [checked]="selectedUserId() === candidate.user_id"
                  (change)="selectedUserId.set(candidate.user_id)"
                />
                <cog-avatar [name]="candidateName(candidate)" [size]="32" />
                <span class="add-member__identity">
                  <span class="add-member__name">{{ candidateName(candidate) }}</span>
                  @if (candidate.email) {
                    <span class="add-member__email">{{ candidate.email }}</span>
                  }
                </span>
              </label>
            }
          </fieldset>

          <div class="add-member__role">
            <span class="add-member__role-label" id="add-member-role-label">
              {{ t('projects.members.roleLabel') }}
            </span>
            <cog-choice-chip-group
              [options]="roleOptions()"
              [value]="role()"
              [ariaLabel]="t('projects.members.roleLabel')"
              (valueChange)="onRoleChange($event)"
            />
            <p class="add-member__role-hint">{{ t('projects.members.roleHint') }}</p>
          </div>
        }
      </div>

      <cog-dialog-actions cogDialogFooter>
        <cog-button appearance="subtle" (click)="cancel()">{{
          t('projects.cancel')
        }}</cog-button>
        <cog-button
          appearance="primary"
          [disabled]="selectedUserId() === null"
          (click)="confirm()"
        >
          {{ t('projects.members.addSubmit') }}
        </cog-button>
      </cog-dialog-actions>
    </cog-dialog-surface>
  `,
  styles: `
    .add-member__body {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-150);
      max-width: 48ch;
    }

    .add-member__intro {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }

    .add-member__candidates {
      margin: 0;
      padding: 0;
      border: none;
      display: grid;
      max-height: 16rem;
      overflow-y: auto;
    }

    .add-member__legend {
      padding: 0 0 var(--cog-space-50);
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-small);
    }

    .add-member__candidate {
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
      padding: var(--cog-space-75) var(--cog-space-50);
      border-radius: var(--cog-radius-100);
      cursor: pointer;
    }

    .add-member__candidate:hover {
      background: var(--cog-surface-hover);
    }

    .add-member__radio {
      accent-color: var(--cog-brand);
    }

    .add-member__identity {
      display: flex;
      flex-direction: column;
    }

    .add-member__name {
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      font-weight: 500;
    }

    .add-member__email {
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-small);
    }

    .add-member__role {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-50);
    }

    .add-member__role-label {
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-small);
    }

    .add-member__role-hint {
      margin: 0;
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-small);
      line-height: var(--cog-lh-body);
    }
  `,
})
export class AddProjectMemberDialogComponent {
  private readonly _dialogRef = inject(
    DialogRef<AddProjectMemberSelection | undefined>,
  );
  private readonly _transloco = inject(TranslocoService);

  readonly data: AddProjectMemberDialogData = inject(DIALOG_DATA);

  protected readonly selectedUserId = signal<string | null>(null);
  protected readonly role = signal<ProjectRole>('Editor');

  // Localised labels come from the projects.members.roles.* keys; the values
  // stay the capitalised wire roles (project_participants convention).
  protected readonly roleOptions = computed(() => [
    {
      value: 'Viewer',
      label: this._transloco.translate('projects.members.roles.viewer'),
    },
    {
      value: 'Editor',
      label: this._transloco.translate('projects.members.roles.editor'),
    },
    {
      value: 'Admin',
      label: this._transloco.translate('projects.members.roles.admin'),
    },
  ]);

  protected candidateName(candidate: OrgMemberRecord): string {
    return candidate.display_name || candidate.email || candidate.user_id;
  }

  protected onRoleChange(value: string | null): void {
    if (value === 'Viewer' || value === 'Editor' || value === 'Admin') {
      this.role.set(value);
    }
  }

  protected cancel(): void {
    this._dialogRef.close(undefined);
  }

  protected confirm(): void {
    const userId = this.selectedUserId();
    if (userId === null) {
      return;
    }
    this._dialogRef.close({ userId, role: this.role() });
  }
}
