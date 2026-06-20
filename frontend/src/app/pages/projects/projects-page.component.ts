import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosBreadcrumbsComponent, CognosButtonComponent } from '@cognos/ui-angular';

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
  ],
  templateUrl: './projects-page.component.html',
  styleUrl: './projects-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsPageComponent {
  private readonly _projects = inject(ProjectService);

  protected readonly projects = this._projects.orderedProjects;

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
    });
  }
}
