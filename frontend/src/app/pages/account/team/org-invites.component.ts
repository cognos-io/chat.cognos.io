import { Dialog } from '@angular/cdk/dialog';
import { DOCUMENT, DatePipe } from '@angular/common';
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
  CognosButtonComponent,
  CognosCalloutComponent,
  CognosCardComponent,
  CognosChoiceChipGroupComponent,
  CognosEmptyStateComponent,
  CognosFieldComponent,
  CognosLozengeComponent,
  CognosTextFieldComponent,
  CognosToastService,
} from '@cognos/ui-angular';

import { ConfirmationDialogComponent } from '@app/components/confirmation-dialog/confirmation-dialog.component';
import {
  OrgInviteCreatedRecord,
  OrgInviteRecord,
  OrgInviteRole,
  OrganisationRecord,
} from '@app/interfaces/organisation';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';
import { buildOrgInviteUrl } from '@app/utils/org-invite-link';

// OrgInvitesComponent mints and manages Organisation invite links (spec §5.5, §8.1).
// Invites work in one sitting for any work email — no Cognos account needed
// yet, no IT or SSO step. The single-use invite link is shown exactly ONCE
// (the server keeps only a hash): after dismissing the panel it can never be
// retrieved again, only revoked and re-issued. v1 sends no email — the admin
// copies and shares the full /invite?token=… URL themselves. Project access is
// granted per Project after acceptance (least privilege), which the form says out loud.
@Component({
  selector: 'app-org-invites',
  standalone: true,
  imports: [
    DatePipe,
    CognosButtonComponent,
    CognosCalloutComponent,
    CognosCardComponent,
    CognosChoiceChipGroupComponent,
    CognosEmptyStateComponent,
    CognosFieldComponent,
    CognosLozengeComponent,
    CognosTextFieldComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <cog-card
        [heading]="t('team.invites.heading')"
        [subtitle]="t('team.invites.subtitle')"
      >
        @if (!createdInvite()) {
          <cog-choice-chip-group
            card-heading-actions
            [options]="roleOptions(t)"
            [value]="role()"
            [ariaLabel]="t('team.invites.roleLabel')"
            (valueChange)="setRole($event)"
          />
        }

        @if (createdInvite(); as invite) {
          <div
            class="team-card__fields org-invites__token"
            role="group"
            [attr.aria-label]="t('team.invites.tokenHeading')"
          >
            <cog-callout tone="success" icon="check">
              <strong>{{ t('team.invites.tokenHeading') }}</strong>
              {{ t('team.invites.tokenBody') }}
            </cog-callout>
            <p class="team-card__note">{{ t('team.invites.linkInstructions') }}</p>
            <cog-field [label]="t('team.invites.tokenLabel')">
              <cog-text-field
                [value]="inviteLink()"
                [readonly]="true"
                [ariaLabel]="t('team.invites.tokenLabel')"
              />
            </cog-field>
          </div>
        } @else {
          <form class="team-card__fields" (submit)="create($event)">
            <cog-field
              [label]="t('team.invites.emailLabel')"
              [hint]="t('team.invites.emailHint')"
            >
              <cog-text-field
                type="email"
                autocomplete="off"
                [placeholder]="t('common.emailPlaceholder')"
                [value]="email()"
                (valueChange)="email.set($event)"
                [ariaLabel]="t('team.invites.emailLabel')"
              />
            </cog-field>
            <p class="team-card__note">{{ t('team.invites.roleHint') }}</p>
            <p class="team-card__note">{{ t('team.invites.projectsHint') }}</p>
          </form>
        }

        @if (createdInvite()) {
          <ng-container card-actions>
            <cog-button appearance="primary" icon="copy" (click)="copyLink()">{{
              t('team.invites.copy')
            }}</cog-button>
            <cog-button appearance="subtle" (click)="dismissToken()">{{
              t('team.invites.done')
            }}</cog-button>
          </ng-container>
        } @else {
          <ng-container card-actions>
            <cog-button
              appearance="primary"
              type="button"
              icon="user-plus"
              [disabled]="createPending()"
              (click)="create()"
              >{{ t('team.invites.submit') }}</cog-button
            >
          </ng-container>
        }
      </cog-card>

      <cog-card [heading]="t('team.invites.pendingHeading')">
        @if (loading()) {
          <p class="org-invites__state" role="status">{{ t('team.loading') }}</p>
        } @else if (error()) {
          <cog-callout tone="danger" icon="triangle-alert">
            {{ t('team.invites.loadError') }}
          </cog-callout>
        } @else if (invites().length === 0) {
          <cog-empty-state
            icon="mail"
            [message]="t('team.invites.empty')"
            role="status"
          />
        } @else {
          <div class="org-invites__scroll">
            <table class="org-invites__table">
              <caption class="org-invites__visually-hidden">
                {{
                  t('team.invites.pendingHeading')
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{{ t('team.invites.colEmail') }}</th>
                  <th scope="col">{{ t('team.invites.colRole') }}</th>
                  <th scope="col">{{ t('team.invites.colExpires') }}</th>
                  <th scope="col">
                    <span class="org-invites__visually-hidden">{{
                      t('team.invites.colActions')
                    }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (invite of invites(); track invite.id) {
                  <tr>
                    <td>{{ invite.invited_email || t('team.invites.linkInvite') }}</td>
                    <td>
                      <cog-lozenge
                        [tone]="invite.role === 'admin' ? 'blue' : 'neutral'"
                        >{{ t('team.roles.' + invite.role) }}</cog-lozenge
                      >
                    </td>
                    <td>{{ invite.expires_at | date: 'mediumDate' }}</td>
                    <td class="org-invites__actions">
                      <cog-button
                        appearance="subtle"
                        [disabled]="revokePending()"
                        (click)="revoke(invite)"
                      >
                        {{ t('team.invites.revoke')
                        }}<span class="org-invites__visually-hidden">{{
                          t('team.invites.revokeSuffix', {
                            email: invite.invited_email || t('team.invites.linkInvite'),
                          })
                        }}</span>
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
    </ng-container>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-200);
    }

    .team-card__fields {
      display: grid;
      gap: var(--cog-space-200);
      margin-top: var(--cog-space-100);
      min-width: 0;
    }

    .team-card__note {
      margin: 0;
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-small);
      line-height: var(--cog-lh-body-sm);
      text-wrap: pretty;
    }

    .org-invites__token {
      gap: var(--cog-space-150);
    }

    .org-invites__state {
      margin: 0;
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-body);
    }

    .org-invites__scroll {
      overflow-x: auto;
    }

    .org-invites__table {
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

    .org-invites__actions {
      text-align: right;
    }

    .org-invites__visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class OrgInvitesComponent {
  private readonly _api = inject(CognosApiService);
  private readonly _dialog = inject(Dialog);
  private readonly _toast = inject(CognosToastService);
  private readonly _errors = inject(ErrorService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _document = inject(DOCUMENT);

  /** The Organisation being managed (caller is Owner/Admin). */
  readonly org = input.required<OrganisationRecord>();

  protected readonly invites = signal<OrgInviteRecord[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  // Create-invite form state.
  protected readonly email = signal('');
  protected readonly role = signal<OrgInviteRole>('member');
  protected readonly createPending = signal(false);
  // The freshly minted invite. This is the ONLY place the token ever exists
  // client-side; dismissing clears it for good (shown-once contract).
  protected readonly createdInvite = signal<OrgInviteCreatedRecord | null>(null);
  protected readonly inviteLink = computed(() => {
    const token = this.createdInvite()?.token;
    if (!token) {
      return '';
    }
    return buildOrgInviteUrl(token, this._document.location.origin);
  });

  protected readonly revokePending = signal(false);

  constructor() {
    // Reload (and drop any shown-once token) when the managed org changes.
    effect(() => {
      const orgId = this.org().id;
      this.createdInvite.set(null);
      this.load(orgId);
    });
  }

  protected roleOptions(
    t: (key: string) => string,
  ): { value: string; label: string }[] {
    return [
      { value: 'member', label: t('team.roles.member') },
      { value: 'admin', label: t('team.roles.admin') },
    ];
  }

  protected setRole(value: string | null): void {
    if (value === 'member' || value === 'admin') {
      this.role.set(value);
    }
  }

  protected reload(): void {
    this.load(this.org().id);
  }

  private load(orgId: string): void {
    this.loading.set(true);
    this.error.set(false);
    this._api
      .listOrgInvites(orgId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (invites) => {
          this.invites.set(invites);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.error.set(true);
        },
      });
  }

  protected create(event?: Event): void {
    event?.preventDefault();
    if (this.createPending()) {
      return;
    }
    this.createPending.set(true);
    const email = this.email().trim();
    this._api
      .createOrgInvite(this.org().id, {
        ...(email ? { email } : {}),
        role: this.role(),
      })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (invite) => {
          this.createPending.set(false);
          this.createdInvite.set(invite);
          this.email.set('');
          this.role.set('member');
          this.reload();
        },
        error: () => {
          this.createPending.set(false);
          this._errors.alert(this._transloco.translate('team.invites.createError'));
        },
      });
  }

  protected async copyLink(): Promise<void> {
    const link = this.inviteLink();
    if (!link) {
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      this.showCopyError();
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      this._toast.notify({
        title: this._transloco.translate('team.invites.copiedToast'),
        tone: 'success',
        icon: 'copy',
      });
    } catch {
      this.showCopyError();
    }
  }

  private showCopyError(): void {
    this._errors.alert(this._transloco.translate('team.invites.copyError'));
  }

  /** Dismiss the shown-once panel. The token is gone for good after this. */
  protected dismissToken(): void {
    this.createdInvite.set(null);
  }

  protected async revoke(invite: OrgInviteRecord): Promise<void> {
    if (this.revokePending()) {
      return;
    }
    const message = this._transloco.translate('team.invites.revokeConfirm');
    const confirmed = await firstValueFrom(
      this._dialog.open<boolean>(ConfirmationDialogComponent, {
        ...cognosDialogOptions(message),
        data: { message },
      }).closed,
    );
    if (!confirmed) {
      return;
    }

    this.revokePending.set(true);
    this._api
      .revokeOrgInvite(this.org().id, invite.id)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => {
          this.revokePending.set(false);
          // Announced via the toast host's aria-live status region.
          this._toast.notify({
            title: this._transloco.translate('team.invites.revokedToast'),
            tone: 'success',
          });
          this.reload();
        },
        error: () => {
          this.revokePending.set(false);
          this._errors.alert(this._transloco.translate('team.invites.revokeError'));
        },
      });
  }
}
