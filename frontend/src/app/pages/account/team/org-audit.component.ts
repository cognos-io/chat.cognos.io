import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosCalloutComponent,
  CognosCardComponent,
  CognosEmptyStateComponent,
} from '@cognos/ui-angular';

import { OrgAuditEventRecord, OrganisationRecord } from '@app/interfaces/organisation';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';

const PAGE_SIZE = 25;
const KNOWN_ACTIONS = new Set([
  'org.billing.checkout_started',
  'org.invite.accepted',
  'org.invite.created',
  'org.invite.revoked',
  'org.member.offboarded',
  'org.member.sessions_revoked',
  'org.dissolved',
  'org.policies.updated',
  'org.project.participant_added',
  'org.project.participant_revoked',
  'org.project.rotated',
]);

/** Owner/Admin view of content-free Organisation administration events. */
@Component({
  selector: 'app-org-audit',
  standalone: true,
  imports: [
    DatePipe,
    CognosButtonComponent,
    CognosCalloutComponent,
    CognosCardComponent,
    CognosEmptyStateComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-card
      *transloco="let t"
      [heading]="t('team.audit.heading')"
      [subtitle]="t('team.audit.subtitle')"
    >
      <cog-button
        card-heading-actions
        appearance="default"
        icon="download"
        [disabled]="exportPending()"
        [ariaLabel]="t('team.audit.exportAria', { org: org().name })"
        (click)="exportCsv()"
      >
        {{ exportPending() ? t('team.audit.exporting') : t('team.audit.export') }}
      </cog-button>

      <cog-callout tone="info" icon="shield-check">
        {{ t('team.audit.metadataOnly') }}
      </cog-callout>

      @if (loading()) {
        <p class="org-audit__state" role="status">{{ t('team.loading') }}</p>
      } @else if (error()) {
        <cog-callout tone="danger" icon="triangle-alert">
          {{ t('team.audit.loadError') }}
        </cog-callout>
        <div class="org-audit__retry">
          <cog-button appearance="default" (click)="loadPage(page())">
            {{ t('team.retry') }}
          </cog-button>
        </div>
      } @else if (events().length === 0) {
        <cog-empty-state icon="list" [message]="t('team.audit.empty')" role="status" />
      } @else {
        <div class="org-audit__scroll">
          <table class="org-audit__table">
            <caption class="org-audit__caption">
              {{
                t('team.audit.tableCaption', { org: org().name })
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('team.audit.colWhen') }}</th>
                <th scope="col">{{ t('team.audit.colActivity') }}</th>
                <th scope="col">{{ t('team.audit.colActor') }}</th>
                <th scope="col">{{ t('team.audit.colTarget') }}</th>
              </tr>
            </thead>
            <tbody>
              @for (event of events(); track event.id) {
                <tr>
                  <td class="org-audit__date">
                    {{ event.created | date: 'medium' }}
                  </td>
                  <td>{{ actionLabel(event.action) }}</td>
                  <td>
                    <code>{{ event.actor }}</code>
                  </td>
                  <td>
                    @if (event.target) {
                      <code>{{ event.target }}</code>
                    } @else {
                      <span aria-hidden="true">—</span>
                      <span class="org-audit__visually-hidden">{{
                        t('team.audit.noTarget')
                      }}</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (!loading() && !error() && totalPages() > 1) {
        <nav
          class="org-audit__pagination"
          [attr.aria-label]="t('team.audit.pagination')"
        >
          <cog-button
            appearance="subtle"
            [disabled]="page() <= 1"
            (click)="loadPage(page() - 1)"
          >
            {{ t('team.audit.previous') }}
          </cog-button>
          <span class="org-audit__page" aria-live="polite">
            {{ t('team.audit.page', { page: page(), total: totalPages() }) }}
          </span>
          <cog-button
            appearance="subtle"
            [disabled]="page() >= totalPages()"
            (click)="loadPage(page() + 1)"
          >
            {{ t('team.audit.next') }}
          </cog-button>
        </nav>
      }
    </cog-card>
  `,
  styles: `
    .org-audit__state {
      margin: var(--cog-space-150) 0 0;
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-body);
    }

    .org-audit__retry {
      margin-top: var(--cog-space-100);
    }

    .org-audit__scroll {
      margin-top: var(--cog-space-150);
      overflow-x: auto;
    }

    .org-audit__table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--cog-fs-body-sm);

      th {
        padding: var(--cog-space-50) var(--cog-space-100);
        border-bottom: 1px solid var(--cog-border);
        color: var(--cog-text-muted);
        font-size: var(--cog-fs-small);
        font-weight: var(--cog-fw-medium);
        text-align: start;
      }

      td {
        padding: var(--cog-space-100);
        border-bottom: 1px solid var(--cog-border);
        color: var(--cog-text);
        vertical-align: top;
      }

      tr:last-child td {
        border-bottom: 0;
      }

      code {
        color: var(--cog-text-muted);
        font-family: var(--cog-font-mono);
        font-size: var(--cog-fs-small);
        overflow-wrap: anywhere;
      }
    }

    .org-audit__date,
    .org-audit__page {
      font-variant-numeric: tabular-nums;
    }

    .org-audit__caption,
    .org-audit__visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    .org-audit__pagination {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      margin-top: var(--cog-space-150);
      gap: var(--cog-space-100);
    }

    .org-audit__page {
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-small);
    }
  `,
})
export class OrgAuditComponent {
  private readonly _api = inject(CognosApiService);
  private readonly _errors = inject(ErrorService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _destroyRef = inject(DestroyRef);

  readonly org = input.required<OrganisationRecord>();

  protected readonly events = signal<OrgAuditEventRecord[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly page = signal(1);
  protected readonly totalPages = signal(0);
  protected readonly exportPending = signal(false);

  constructor() {
    effect(() => {
      this.org().id;
      this.loadPage(1);
    });
  }

  protected loadPage(page: number): void {
    if (page < 1) {
      return;
    }
    this.loading.set(true);
    this.error.set(false);
    this._api
      .listOrgAudit(this.org().id, page, PAGE_SIZE)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (response) => {
          this.events.set(response.items);
          this.page.set(response.page);
          this.totalPages.set(response.totalPages);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.error.set(true);
        },
      });
  }

  protected actionLabel(action: string): string {
    return KNOWN_ACTIONS.has(action)
      ? this._transloco.translate(`team.audit.actions.${action}`)
      : action;
  }

  protected exportCsv(): void {
    if (this.exportPending()) {
      return;
    }
    this.exportPending.set(true);
    this._api
      .exportOrgAudit(this.org().id)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (blob) => {
          this.exportPending.set(false);
          this.download(blob, `${this.filenamePart(this.org().name)}-audit-log.csv`);
        },
        error: () => {
          this.exportPending.set(false);
          this._errors.alert(this._transloco.translate('team.audit.exportError'));
        },
      });
  }

  protected filenamePart(name: string): string {
    return (
      name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'organisation'
    );
  }

  protected download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}
