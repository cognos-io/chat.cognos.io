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
import { Router, RouterLink } from '@angular/router';

import { EMPTY, catchError } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosCalloutComponent,
  CognosCardComponent,
  CognosFieldComponent,
  CognosLozengeComponent,
  CognosTextFieldComponent,
} from '@cognos/ui-angular';

import { OrgRole } from '@app/interfaces/organisation';
import { CognosApiService } from '@app/services/cognos-api.service';
import { OrganisationService } from '@app/services/organisation.service';

type AcceptState = 'idle' | 'accepting' | 'error' | 'success';

interface AcceptedMembership {
  organisationId: string;
  /** Empty string when the membership list could not be refreshed in time. */
  orgName: string;
  role: OrgRole;
  /** True when the Workspace switch happened; false shows the manual hint. */
  switched: boolean;
}

// InviteAcceptComponent is the /invite landing page (behind the `team` flag).
// It accepts an Organisation invite token, from the email deep link
// (?token=…) or pasted by hand, in one sitting with no ceremony (spec §8.1,
// persona PER-006 friction #3): the SAME signed-in Account joins — no new
// account, no re-login, no second Emergency Kit. On success the active
// Workspace switches to the new Organisation and a welcome state names the
// org and the granted role. Unknown/expired/consumed tokens all show the same
// neutral copy with a paste-and-retry field.
@Component({
  selector: 'app-invite-accept',
  standalone: true,
  imports: [
    CognosButtonComponent,
    CognosCalloutComponent,
    CognosCardComponent,
    CognosFieldComponent,
    CognosLozengeComponent,
    CognosTextFieldComponent,
    RouterLink,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main *transloco="let t" class="invite-accept">
      <div class="invite-accept__inner" aria-live="polite">
        @if (state() === 'success' && accepted(); as membership) {
          <cog-card
            [heading]="t('team.accept.welcomeTitle', { org: displayOrgName() })"
          >
            <div class="invite-accept__welcome">
              <p class="invite-accept__role">
                {{ t('team.accept.welcomeRole') }}
                <cog-lozenge [tone]="roleTone()">{{ roleLabel() }}</cog-lozenge>
              </p>
              <cog-callout tone="info" icon="shield-check">
                {{ t('team.accept.sameAccount') }}
              </cog-callout>
              <p class="invite-accept__note">
                {{ t('team.accept.billingNote', { org: displayOrgName() }) }}
              </p>
              @if (!membership.switched) {
                <p class="invite-accept__note">
                  {{ t('team.accept.switchHint', { org: displayOrgName() }) }}
                </p>
              }
            </div>
            <cog-button card-actions appearance="primary" (click)="startWorking()">
              {{ t('team.accept.startWorking') }}
            </cog-button>
          </cog-card>
        } @else {
          <cog-card
            [heading]="t('team.accept.title')"
            [subtitle]="t('team.accept.intro')"
          >
            <div class="invite-accept__form">
              <cog-callout tone="info" icon="shield-check">
                {{ t('team.accept.sameAccount') }}
              </cog-callout>

              @if (state() === 'error') {
                <cog-callout tone="danger" icon="triangle-alert" role="alert">
                  {{ t('team.accept.error') }}
                </cog-callout>
              }

              @if (state() === 'accepting') {
                <p class="invite-accept__status" role="status">
                  {{ t('team.accept.accepting') }}
                </p>
              } @else {
                <form (submit)="$event.preventDefault(); submitManual()">
                  <cog-field [label]="t('team.accept.tokenLabel')">
                    <cog-text-field
                      [value]="manualToken()"
                      [placeholder]="t('team.accept.tokenPlaceholder')"
                      [ariaLabel]="t('team.accept.tokenLabel')"
                      (valueChange)="manualToken.set($event)"
                    />
                  </cog-field>
                  <div class="invite-accept__actions">
                    <cog-button
                      appearance="primary"
                      type="submit"
                      [disabled]="manualToken().trim() === ''"
                    >
                      {{
                        state() === 'error'
                          ? t('team.accept.retry')
                          : t('team.accept.submit')
                      }}
                    </cog-button>
                  </div>
                </form>
              }
            </div>
          </cog-card>
          <p class="invite-accept__back">
            <a routerLink="/">{{ t('team.accept.backToChat') }}</a>
          </p>
        }
      </div>
    </main>
  `,
  styles: `
    .invite-accept {
      min-height: 100dvh;
      display: flex;
      justify-content: center;
      padding: var(--cog-space-400) var(--cog-space-200);
      background: var(--cog-surface);
    }

    .invite-accept__inner {
      width: 100%;
      max-width: 34rem;
      margin-top: clamp(var(--cog-space-200), 12vh, var(--cog-space-800));
    }

    .invite-accept__form,
    .invite-accept__welcome {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-150);
    }

    .invite-accept__role {
      margin: 0;
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }

    .invite-accept__note,
    .invite-accept__status {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }

    .invite-accept__actions {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--cog-space-150);
    }

    .invite-accept__back {
      margin: var(--cog-space-200) 0 0;
      text-align: center;
      font-size: var(--cog-fs-body-sm);
    }

    .invite-accept__back a {
      color: var(--cog-text-subtle);
    }
  `,
})
export class InviteAcceptComponent {
  private readonly _api = inject(CognosApiService);
  private readonly _workspaces = inject(OrganisationService);
  private readonly _router = inject(Router);
  private readonly _transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);

  /** Bound from the ?token= query parameter via withComponentInputBinding(). */
  readonly token = input('');

  protected readonly state = signal<AcceptState>('idle');
  protected readonly manualToken = signal('');
  protected readonly accepted = signal<AcceptedMembership | null>(null);

  protected readonly displayOrgName = computed(
    () =>
      this.accepted()?.orgName || this._transloco.translate('team.accept.genericOrg'),
  );

  protected readonly roleLabel = computed(() => {
    const role = this.accepted()?.role;
    return role ? this._transloco.translate(`team.roles.${role}`) : '';
  });

  protected readonly roleTone = computed(() =>
    this.accepted()?.role === 'member' ? 'neutral' : 'blue',
  );

  // The email deep link should complete without a single click (one sitting,
  // no ceremony) — auto-redeem the token exactly once.
  private _autoAccepted = false;

  constructor() {
    effect(() => {
      const token = this.token().trim();
      if (token !== '' && !this._autoAccepted) {
        this._autoAccepted = true;
        this.accept(token);
      }
    });
  }

  protected submitManual(): void {
    const token = this.manualToken().trim();
    if (token === '' || this.state() === 'accepting') {
      return;
    }
    this.accept(token);
  }

  protected startWorking(): void {
    void this._router.navigateByUrl('/');
  }

  private accept(token: string): void {
    this.state.set('accepting');
    this._api
      .acceptOrgInvite({ token })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => {
          // Unknown, expired and consumed tokens are indistinguishable by
          // design (neutral 404) — one calm message plus a retry field.
          this.state.set('error');
          return EMPTY;
        }),
      )
      .subscribe((response) => {
        this.onAccepted(response.organisation, response.role);
      });
  }

  // onAccepted refreshes the membership list so the new Organisation is
  // switchable, then activates it. A refresh failure still counts as success
  // (the membership exists server-side) — the welcome state falls back to a
  // generic name and points at the sidebar switcher.
  private onAccepted(organisationId: string, role: OrgRole): void {
    this._workspaces
      .refreshMemberships()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => {
          this.accepted.set({ organisationId, orgName: '', role, switched: false });
          this.state.set('success');
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._workspaces.setActiveWorkspace(organisationId);
        const switched = this._workspaces.activeWorkspace() === organisationId;
        this.accepted.set({
          organisationId,
          orgName: this._workspaces.orgName(organisationId) ?? '',
          role,
          switched,
        });
        this.state.set('success');
      });
  }
}
