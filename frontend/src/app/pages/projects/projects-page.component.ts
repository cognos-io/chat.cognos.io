import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosBreadcrumbsComponent, CognosButtonComponent } from '@cognos/ui-angular';

import { OrgBillingBannerComponent } from '@app/components/billing/org-billing-banner/org-billing-banner.component';
import { WorkspaceContextBadgeComponent } from '@app/components/chat/workspace-context-badge/workspace-context-badge.component';
import { PersonaAvatarComponent } from '@app/components/personas/persona-avatar/persona-avatar.component';
import { defaultProjectColor, defaultProjectIcon } from '@app/interfaces/project';
import { OrgBillingContextService } from '@app/services/org-billing-context.service';
import { OrganisationService } from '@app/services/organisation.service';
import { ProjectService } from '@app/services/project.service';

@Component({
  selector: 'app-projects-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoModule,
    CognosBreadcrumbsComponent,
    CognosButtonComponent,
    PersonaAvatarComponent,
    WorkspaceContextBadgeComponent,
    OrgBillingBannerComponent,
  ],
  templateUrl: './projects-page.component.html',
  styleUrl: './projects-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsPageComponent {
  private readonly _projects = inject(ProjectService);
  private readonly _router = inject(Router);
  private readonly _workspaces = inject(OrganisationService);
  private readonly _orgBilling = inject(OrgBillingContextService);

  protected readonly orgBillingBlock = this._orgBilling.activeOrgBillingBlock;
  protected readonly orgWritesBlocked = this._orgBilling.orgWorkspaceWritesBlocked;

  // Scoped to the active Workspace (personal Projects, or the active
  // Organisation's) — same filter as the sidebar (spec §5.2).
  protected readonly projects = computed(() =>
    this._workspaces.visibleProjects(this._projects.orderedProjects()),
  );

  // Workspace/billing context (spec §5.2): shown only once the account holds
  // org memberships — individual accounts see zero change. The badge and the
  // create-card hint both follow the ACTIVE Workspace, because that's where a
  // new project will land.
  protected readonly hasMemberships = this._workspaces.hasMemberships;
  protected readonly billedOrgName = computed(
    () => this._workspaces.activeOrg()?.name ?? null,
  );

  // Routes for the breadcrumb crumbs, in order. The last crumb (Projects) is
  // the current page and has no route.
  private readonly breadcrumbRoutes = ['/', '/account'];

  protected onBreadcrumb(index: number): void {
    const route = this.breadcrumbRoutes[index];
    if (route) {
      this._router.navigateByUrl(route);
    }
  }

  // Inline create form, always visible in its own card (matching the
  // account settings layout).
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly creating = signal(false);

  constructor() {
    this._projects.projectCreateFailed$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.creating.set(false);
    });
  }

  protected create(): void {
    if (this.orgWritesBlocked()) {
      return;
    }
    const name = this.name().trim();
    if (name === '' || this.creating()) {
      return;
    }
    this.creating.set(true);
    // The service handles encryption + persistence and navigates to the new
    // project's detail page on success.
    this._projects.newProject$.next({
      version: '1',
      name,
      description: this.description().trim(),
      icon: defaultProjectIcon,
      color: defaultProjectColor,
      instructions: '',
      defaultModelId: '',
    });
  }
}
