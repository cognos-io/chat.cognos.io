import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { firstValueFrom } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosAvatarComponent,
  CognosButtonComponent,
  CognosCalloutComponent,
  CognosIconComponent,
  CognosLozengeComponent,
  CognosToastService,
} from '@cognos/ui-angular';

import { OrgMemberRecord } from '@app/interfaces/organisation';
import {
  Project,
  ProjectParticipantRecord,
  ProjectRole,
} from '@app/interfaces/project';
import { AuthService } from '@app/services/auth.service';
import { CognosApiService } from '@app/services/cognos-api.service';
import { OrganisationService } from '@app/services/organisation.service';
import {
  ProjectRotationError,
  ProjectRotationPhase,
  ProjectSharingService,
} from '@app/services/project-sharing.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

import {
  AddProjectMemberDialogComponent,
  AddProjectMemberDialogData,
  AddProjectMemberSelection,
} from './add-project-member-dialog.component';
import {
  RevokeProjectMemberDialogComponent,
  RevokeProjectMemberDialogData,
} from './revoke-project-member-dialog.component';

type RotationStatus =
  | { state: 'idle' }
  | { state: 'running'; phase: ProjectRotationPhase }
  | { state: 'done' }
  | { state: 'failed'; phase: ProjectRotationPhase };

// ProjectMembersComponent is the Members section of an org-owned Project's
// detail page (spec §9): who participates, adding an active org member (the
// admin's client seals the CURRENT project content key to the invitee's
// Account public key), and revoking with the forward-only key rotation that
// follows. Rendered only for org-owned Projects — personal Projects have no
// sharing in v1.
//
// Names/emails are resolved via the org member list (any active org member
// may read it). Manage affordances follow the public-key endpoint's gate:
// Owners/Admins of the owning Organisation.
@Component({
  selector: 'app-project-members',
  standalone: true,
  imports: [
    CognosAvatarComponent,
    CognosButtonComponent,
    CognosCalloutComponent,
    CognosIconComponent,
    CognosLozengeComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      *transloco="let t"
      class="project-members"
      aria-labelledby="project-members-heading"
    >
      <div class="project-members__head">
        <h2 id="project-members-heading" class="project-members__title">
          <cog-icon name="users" [size]="15" tone="text-subtle" />
          <span>{{ t('projects.members.heading') }}</span>
          <span class="project-members__dot" aria-hidden="true">·</span>
          <span class="project-members__count">{{ participants().length }}</span>
        </h2>
        @if (canManage()) {
          <cog-button
            appearance="default"
            icon="plus"
            [disabled]="busy()"
            (click)="openAddDialog()"
            data-testid="project-members-add"
          >
            {{ t('projects.members.add') }}
          </cog-button>
        }
      </div>

      @if (loading()) {
        <p class="project-members__state" role="status">{{ t('team.loading') }}</p>
      } @else if (loadError()) {
        <cog-callout tone="danger" icon="triangle-alert">
          {{ t('projects.members.loadError') }}
        </cog-callout>
        <div class="project-members__retry">
          <cog-button appearance="default" (click)="reload()">{{
            t('team.retry')
          }}</cog-button>
        </div>
      } @else {
        <ul class="project-members__list" data-testid="project-members-list">
          @for (participant of participants(); track participant.user_id) {
            <li class="project-members__row">
              <span class="project-members__person">
                <cog-avatar [name]="participantName(participant)" [size]="32" />
                <span class="project-members__identity">
                  <span class="project-members__name">
                    {{ participantName(participant) }}
                    @if (participant.user_id === myUserId()) {
                      <span class="project-members__you">{{
                        t('projects.members.you')
                      }}</span>
                    }
                  </span>
                  @if (participantEmail(participant); as email) {
                    <span class="project-members__email">{{ email }}</span>
                  }
                </span>
              </span>
              <span class="project-members__meta">
                @if (isCreator(participant)) {
                  <cog-lozenge tone="purple">{{
                    t('projects.members.creatorBadge')
                  }}</cog-lozenge>
                }
                <cog-lozenge [tone]="roleTone(participant.role)">{{
                  roleLabel(participant.role)
                }}</cog-lozenge>
                @if (canRevoke(participant)) {
                  <cog-button
                    appearance="subtle"
                    [disabled]="busy()"
                    (click)="revoke(participant)"
                  >
                    {{ t('projects.members.remove')
                    }}<span class="project-members__visually-hidden">{{
                      t('projects.members.removeSuffix', {
                        name: participantName(participant),
                      })
                    }}</span>
                  </cog-button>
                }
              </span>
            </li>
          }
        </ul>
      }

      @if (rotation().state === 'running') {
        <p class="project-members__rotation" role="status">
          {{ rotationPhaseLabel() }}
        </p>
      } @else if (rotation().state === 'done') {
        <cog-callout tone="success" icon="key-round" role="status">
          {{ t('projects.members.rotateDone') }}
        </cog-callout>
      } @else if (rotation().state === 'failed') {
        <cog-callout tone="danger" icon="triangle-alert" role="alert">
          {{ rotationFailureLabel() }}
        </cog-callout>
        <div class="project-members__retry">
          <cog-button
            appearance="default"
            [disabled]="busy()"
            (click)="retryRotation()"
            data-testid="project-members-rotate-retry"
          >
            {{ t('projects.members.rotateRetry') }}
          </cog-button>
        </div>
      }
    </section>
  `,
  styles: `
    .project-members {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-150);
    }

    .project-members__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--cog-space-100);
    }

    .project-members__title {
      margin: 0;
      display: flex;
      align-items: center;
      gap: var(--cog-space-75);
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      font-weight: 600;
    }

    .project-members__dot,
    .project-members__count {
      color: var(--cog-text-muted);
      font-weight: 400;
    }

    .project-members__state,
    .project-members__rotation {
      margin: 0;
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-body);
    }

    .project-members__retry {
      margin-top: var(--cog-space-50);
    }

    .project-members__list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
    }

    .project-members__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--cog-space-100);
      padding: var(--cog-space-100) 0;
      border-bottom: 1px solid var(--cog-border);
    }

    .project-members__row:last-child {
      border-bottom: none;
    }

    .project-members__person {
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
      min-width: 0;
    }

    .project-members__identity {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .project-members__name {
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      font-weight: 500;
    }

    .project-members__you {
      color: var(--cog-text-muted);
      font-weight: 400;
    }

    .project-members__email {
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-small);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .project-members__meta {
      display: flex;
      align-items: center;
      gap: var(--cog-space-75);
      flex-shrink: 0;
    }

    .project-members__visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class ProjectMembersComponent {
  private readonly _api = inject(CognosApiService);
  private readonly _sharing = inject(ProjectSharingService);
  private readonly _workspaces = inject(OrganisationService);
  private readonly _auth = inject(AuthService);
  private readonly _dialog = inject(Dialog);
  private readonly _toast = inject(CognosToastService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _destroyRef = inject(DestroyRef);

  /** The org-owned project whose participants are managed. */
  readonly project = input.required<Project>();

  protected readonly participants = signal<ProjectParticipantRecord[]>([]);
  protected readonly orgMembers = signal<OrgMemberRecord[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly mutating = signal(false);
  protected readonly rotation = signal<RotationStatus>({ state: 'idle' });

  protected readonly busy = computed(
    () => this.mutating() || this.rotation().state === 'running',
  );

  protected readonly myUserId = computed(
    () => (this._auth.user()?.['id'] as string | undefined) ?? '',
  );

  // Manage affordances mirror the server's gates: adding/revoking needs
  // project-admin rights AND fetching member public keys needs org
  // Owner/Admin — so the UI offers management to org Owners/Admins.
  protected readonly canManage = computed(() => {
    const orgId = this.project().record.organisation;
    const role = this._workspaces.memberships().find((org) => org.id === orgId)?.role;
    return role === 'owner' || role === 'admin';
  });

  private _loadedProjectId = '';

  constructor() {
    effect(() => {
      const projectId = this.project().record.id;
      if (projectId !== this._loadedProjectId) {
        this._loadedProjectId = projectId;
        this.load();
      }
    });
  }

  protected reload(): void {
    this.load();
  }

  private load(): void {
    const projectId = this.project().record.id;
    const orgId = this.project().record.organisation;
    if (!orgId) {
      return;
    }
    this.loading.set(true);
    this.loadError.set(false);
    this._sharing
      .listParticipants(projectId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (participants) => {
          this.participants.set(participants);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.loadError.set(true);
        },
      });
    // Name resolution is best-effort: a failure leaves user ids visible but
    // never blocks the participant list itself.
    this._api
      .listOrgMembers(orgId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (members) => this.orgMembers.set(members),
        error: () => this.orgMembers.set([]),
      });
  }

  private orgMemberFor(userId: string): OrgMemberRecord | undefined {
    return this.orgMembers().find((member) => member.user_id === userId);
  }

  protected participantName(participant: ProjectParticipantRecord): string {
    const member = this.orgMemberFor(participant.user_id);
    return member?.display_name || member?.email || participant.user_id;
  }

  protected participantEmail(participant: ProjectParticipantRecord): string {
    const member = this.orgMemberFor(participant.user_id);
    return member?.display_name ? (member.email ?? '') : '';
  }

  protected isCreator(participant: ProjectParticipantRecord): boolean {
    return participant.user_id === this.project().record.creator;
  }

  protected canRevoke(participant: ProjectParticipantRecord): boolean {
    return (
      this.canManage() &&
      !this.isCreator(participant) &&
      participant.user_id !== this.myUserId()
    );
  }

  protected roleTone(role: ProjectRole): 'purple' | 'blue' | 'neutral' {
    switch (role) {
      case 'Admin':
        return 'blue';
      case 'Editor':
        return 'neutral';
      default:
        return 'neutral';
    }
  }

  protected roleLabel(role: ProjectRole): string {
    switch (role) {
      case 'Admin':
        return this._transloco.translate('projects.members.roles.admin');
      case 'Editor':
        return this._transloco.translate('projects.members.roles.editor');
      default:
        return this._transloco.translate('projects.members.roles.viewer');
    }
  }

  protected rotationPhaseLabel(): string {
    const rotation = this.rotation();
    if (rotation.state !== 'running') {
      return '';
    }
    switch (rotation.phase) {
      case 'preparing':
        return this._transloco.translate('projects.members.rotatePreparing');
      case 'rotating':
        return this._transloco.translate('projects.members.rotateApplying');
      default:
        return this._transloco.translate('projects.members.rotateFinalising');
    }
  }

  protected rotationFailureLabel(): string {
    const rotation = this.rotation();
    if (rotation.state !== 'failed') {
      return '';
    }
    // Be precise about what state the project is in: before/at the commit the
    // OLD key is still the valid one; after it only metadata re-encryption is
    // left.
    return this._transloco.translate(
      rotation.phase === 'finalising'
        ? 'projects.members.rotateFinaliseFailed'
        : 'projects.members.rotateFailedOldValid',
    );
  }

  protected async openAddDialog(): Promise<void> {
    if (this.busy()) {
      return;
    }
    const project = this.project();
    const participantIds = new Set(this.participants().map((p) => p.user_id));
    const data: AddProjectMemberDialogData = {
      candidates: this.orgMembers().filter(
        (member) => !participantIds.has(member.user_id),
      ),
      projectName: project.decryptedData.name,
      orgName: this._workspaces.orgName(project.record.organisation) ?? '',
    };
    const selection = await firstValueFrom(
      this._dialog.open<AddProjectMemberSelection | undefined>(
        AddProjectMemberDialogComponent,
        {
          ...cognosDialogOptions(
            this._transloco.translate('projects.members.addTitle', {
              project: data.projectName,
            }),
          ),
          data,
        },
      ).closed,
    );
    if (!selection) {
      return;
    }

    this.mutating.set(true);
    this._sharing
      .addParticipant(project, selection.userId, selection.role)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => {
          this.mutating.set(false);
          const member = this.orgMemberFor(selection.userId);
          // The toast host is an aria-live status region, so this announces.
          this._toast.notify({
            title: this._transloco.translate('projects.members.addedToast', {
              name: member?.display_name || member?.email || selection.userId,
            }),
            tone: 'success',
          });
          this.load();
        },
        error: () => {
          this.mutating.set(false);
          this._toast.notify({
            title: this._transloco.translate('projects.members.addError'),
            tone: 'danger',
          });
        },
      });
  }

  protected async revoke(participant: ProjectParticipantRecord): Promise<void> {
    if (this.busy() || !this.canRevoke(participant)) {
      return;
    }
    const project = this.project();
    const data: RevokeProjectMemberDialogData = {
      memberName: this.participantName(participant),
      projectName: project.decryptedData.name,
    };
    const confirmed = await firstValueFrom(
      this._dialog.open<boolean>(RevokeProjectMemberDialogComponent, {
        ...cognosDialogOptions(
          this._transloco.translate('projects.members.revokeTitle', {
            name: data.memberName,
          }),
        ),
        data,
      }).closed,
    );
    if (!confirmed) {
      return;
    }

    this.mutating.set(true);
    this._sharing
      .revokeParticipant(project.record.id, participant.user_id)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => {
          this.mutating.set(false);
          this.load();
          // Forward-only model: rotate immediately so future content uses a
          // key the removed person never had (spec §9.2).
          this.runRotation();
        },
        error: () => {
          this.mutating.set(false);
          this._toast.notify({
            title: this._transloco.translate('projects.members.revokeError'),
            tone: 'danger',
          });
        },
      });
  }

  protected retryRotation(): void {
    if (this.busy()) {
      return;
    }
    const project = this.project();
    if (this._sharing.hasPendingFinalise(project.record.id)) {
      this.subscribeRotation(this._sharing.retryFinalise(project));
      return;
    }
    this.runRotation();
  }

  private runRotation(): void {
    this.subscribeRotation(this._sharing.rotateKey(this.project()));
  }

  private subscribeRotation(
    phases$: ReturnType<ProjectSharingService['rotateKey']>,
  ): void {
    this.rotation.set({ state: 'running', phase: 'preparing' });
    phases$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: (phase) => {
        if (phase === 'done') {
          this.rotation.set({ state: 'done' });
        } else {
          this.rotation.set({ state: 'running', phase });
        }
      },
      error: (error: unknown) => {
        const phase = error instanceof ProjectRotationError ? error.phase : 'preparing';
        this.rotation.set({ state: 'failed', phase });
      },
    });
  }
}
