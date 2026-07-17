import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosBreadcrumbsComponent, CognosButtonComponent } from '@cognos/ui-angular';

import { PersonaAvatarComponent } from '@app/components/personas/persona-avatar/persona-avatar.component';
import { defaultProjectColor, defaultProjectIcon } from '@app/interfaces/project';
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
  ],
  templateUrl: './projects-page.component.html',
  styleUrl: './projects-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsPageComponent {
  private readonly _projects = inject(ProjectService);
  private readonly _router = inject(Router);
  private readonly _workspaces = inject(OrganisationService);

  // Scoped to the active Workspace (personal Projects, or the active
  // Organisation's) — same filter as the sidebar (spec §5.2).
  protected readonly projects = computed(() =>
    this._workspaces.visibleProjects(this._projects.orderedProjects()),
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

  protected create(): void {
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
