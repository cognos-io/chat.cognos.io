import { Dialog } from '@angular/cdk/dialog';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { catchError, firstValueFrom, forkJoin, last, map, of, switchMap } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosAvatarComponent,
  CognosButtonComponent,
  CognosCalloutComponent,
  CognosCardComponent,
  CognosEmptyStateComponent,
  CognosLozengeComponent,
  CognosToastService,
} from '@cognos/ui-angular';

import {
  OrgMemberRecord,
  OrgRole,
  OrganisationRecord,
} from '@app/interfaces/organisation';
import { AuthService } from '@app/services/auth.service';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';
import { ProjectSharingService } from '@app/services/project-sharing.service';
import { ProjectService } from '@app/services/project.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

import {
  OffboardMemberDialogComponent,
  OffboardMemberDialogData,
} from './offboard-member-dialog.component';

// OrgMembersComponent lists everyone holding a Seat (spec §5.3) and offers
// offboarding (spec §8.2). Roles are display-only in this slice — role
// management is a later slice. The Owner row and the caller's own row never
// offer Remove: the Owner cannot offboard themselves, and leaving is not the
// same flow as removing.
@Component({
  selector: 'app-org-members',
  standalone: true,
  imports: [
    DatePipe,
    CognosAvatarComponent,
    CognosButtonComponent,
    CognosCalloutComponent,
    CognosCardComponent,
    CognosEmptyStateComponent,
    CognosLozengeComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-card
      *transloco="let t"
      [heading]="t('team.members.heading')"
      [subtitle]="t('team.members.subtitle')"
    >
      @if (rotationPending()) {
        <cog-callout tone="info" icon="refresh-cw" role="status">
          {{ t('team.offboard.rotating') }}
        </cog-callout>
      }
      @if (loading()) {
        <p class="org-members__state" role="status">{{ t('team.loading') }}</p>
      } @else if (error()) {
        <cog-callout tone="danger" icon="triangle-alert">
          {{ t('team.members.loadError') }}
        </cog-callout>
      } @else if (members().length === 0) {
        <cog-empty-state
          icon="users"
          [message]="t('team.members.empty')"
          role="status"
        />
      } @else {
        <div class="org-members__scroll">
          <table class="org-members__table">
            <caption class="org-members__caption">
              {{
                t('team.members.tableCaption', { org: org().name })
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('team.members.colMember') }}</th>
                <th scope="col">{{ t('team.members.colRole') }}</th>
                <th scope="col">{{ t('team.members.colAdded') }}</th>
                <th scope="col">
                  <span class="org-members__visually-hidden">{{
                    t('team.members.colActions')
                  }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (member of members(); track member.user_id) {
                <tr>
                  <td>
                    <span class="org-members__person">
                      <cog-avatar [name]="memberName(member)" [size]="32" />
                      <span class="org-members__identity">
                        <span class="org-members__name">{{ memberName(member) }}</span>
                        @if (
                          member.email &&
                          member.display_name &&
                          member.email !== member.display_name
                        ) {
                          <span class="org-members__email">{{ member.email }}</span>
                        }
                      </span>
                    </span>
                  </td>
                  <td>
                    <cog-lozenge [tone]="roleTone(member.role)">{{
                      t('team.roles.' + member.role)
                    }}</cog-lozenge>
                  </td>
                  <td>{{ member.added_at | date: 'mediumDate' }}</td>
                  <td class="org-members__actions">
                    <cog-button
                      appearance="subtle"
                      [ariaLabel]="
                        t('team.members.removeSuffix', { name: memberName(member) })
                      "
                      [disabled]="removeLockReason(member) !== null || removePending()"
                      [title]="
                        removeLockReason(member) ? t(removeLockReason(member)!) : ''
                      "
                      (click)="offboard(member)"
                    >
                      {{ t('team.members.remove') }}
                    </cog-button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (error()) {
        <ng-container card-actions>
          <cog-button appearance="default" (click)="reload()">{{
            t('team.retry')
          }}</cog-button>
        </ng-container>
      }
    </cog-card>
  `,
  styles: `
    .org-members__state {
      margin: 0;
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-body);
    }

    .org-members__scroll {
      overflow-x: auto;
    }

    .org-members__table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--cog-fs-body);

      th {
        padding: var(--cog-space-50) var(--cog-space-100);
        border-bottom: 1px solid var(--cog-border);
        color: var(--cog-text-muted);
        font-size: var(--cog-fs-small);
        font-weight: 500;
        text-align: left;
      }

      td {
        padding: var(--cog-space-100);
        border-bottom: 1px solid var(--cog-border);
        color: var(--cog-text);
        vertical-align: middle;
      }

      tr:last-child td {
        border-bottom: none;
      }
    }

    .org-members__caption {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    .org-members__visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    .org-members__person {
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
    }

    .org-members__identity {
      display: flex;
      flex-direction: column;
    }

    .org-members__name {
      font-weight: 500;
    }

    .org-members__email {
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-small);
    }

    .org-members__actions {
      text-align: right;
    }
  `,
})
export class OrgMembersComponent {
  private readonly _api = inject(CognosApiService);
  private readonly _auth = inject(AuthService);
  private readonly _dialog = inject(Dialog);
  private readonly _toast = inject(CognosToastService);
  private readonly _errors = inject(ErrorService);
  private readonly _injector = inject(Injector);
  private readonly _transloco = inject(TranslocoService);
  private readonly _destroyRef = inject(DestroyRef);

  /** The Organisation being managed (caller is Owner/Admin). */
  readonly org = input.required<OrganisationRecord>();

  protected readonly members = signal<OrgMemberRecord[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly removePending = signal(false);
  protected readonly rotationPending = signal(false);

  private readonly _myUserId = computed(
    () => (this._auth.user()?.['id'] as string | undefined) ?? '',
  );

  constructor() {
    // Reload whenever the managed Organisation changes.
    effect(() => this.load(this.org().id));
  }

  protected reload(): void {
    this.load(this.org().id);
  }

  private load(orgId: string): void {
    this.loading.set(true);
    this.error.set(false);
    this._api
      .listOrgMembers(orgId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (members) => {
          this.members.set(members);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.error.set(true);
        },
      });
  }

  protected memberName(member: OrgMemberRecord): string {
    return member.display_name || member.email || member.user_id;
  }

  protected roleTone(role: OrgRole): 'purple' | 'blue' | 'neutral' {
    switch (role) {
      case 'owner':
        return 'purple';
      case 'admin':
        return 'blue';
      default:
        return 'neutral';
    }
  }

  /**
   * removeLockReason returns the i18n key explaining why a row cannot be
   * removed, or null when removal is offered. The Owner can never be removed
   * here (and so can never offboard themselves), and removing yourself is not
   * offered — leaving an Organisation is a different flow.
   */
  protected removeLockReason(member: OrgMemberRecord): string | null {
    if (member.role === 'owner') {
      return 'team.members.ownerLocked';
    }
    if (member.user_id === this._myUserId()) {
      return 'team.members.selfLocked';
    }
    return null;
  }

  protected async offboard(member: OrgMemberRecord): Promise<void> {
    if (this.removePending() || this.removeLockReason(member) !== null) {
      return;
    }
    const data: OffboardMemberDialogData = {
      memberName: this.memberName(member),
      orgName: this.org().name,
    };
    const confirmed = await firstValueFrom(
      this._dialog.open<boolean>(OffboardMemberDialogComponent, {
        ...cognosDialogOptions(
          this._transloco.translate('team.offboard.title', { name: data.memberName }),
        ),
        data,
      }).closed,
    );
    if (!confirmed) {
      return;
    }

    this.removePending.set(true);
    this._api
      .removeOrgMember(this.org().id, member.user_id)
      .pipe(
        switchMap((response) => {
          if (response.rotation_project_ids.length === 0) {
            return of(0);
          }
          this.rotationPending.set(true);
          const projectsService = this._injector.get(ProjectService);
          const sharingService = this._injector.get(ProjectSharingService);
          const rotations = response.rotation_project_ids.map((projectId) => {
            const project = projectsService
              .projects()
              .find((candidate) => candidate.record.id === projectId);
            if (!project) {
              return of(false);
            }
            return sharingService.rotateKey(project).pipe(
              last(),
              map(() => true),
              catchError(() => of(false)),
            );
          });
          return forkJoin(rotations).pipe(
            map((results) => results.filter((rotated) => !rotated).length),
          );
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe({
        next: (unresolvedRotations) => {
          this.removePending.set(false);
          this.rotationPending.set(false);
          // The toast host is an aria-live status region, so this announces.
          this._toast.notify({
            title:
              unresolvedRotations > 0
                ? this._transloco.translate('team.members.removedRotationPending', {
                    count: unresolvedRotations,
                  })
                : this._transloco.translate('team.members.removedToast', {
                    name: data.memberName,
                  }),
            tone: unresolvedRotations > 0 ? 'danger' : 'success',
          });
          this.reload();
        },
        error: (error: unknown) => {
          this.removePending.set(false);
          this.rotationPending.set(false);
          const messageKey =
            error instanceof HttpErrorResponse && error.status === 409
              ? 'team.members.removeNeedsProjectAdmin'
              : 'team.members.removeError';
          this._errors.alert(this._transloco.translate(messageKey));
        },
      });
  }
}
