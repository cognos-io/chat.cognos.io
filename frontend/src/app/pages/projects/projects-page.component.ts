import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosButtonComponent, CognosIconComponent } from '@cognos/ui-angular';

import { ProjectService } from '@app/services/project.service';

@Component({
  selector: 'app-projects-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoModule,
    CognosButtonComponent,
    CognosIconComponent,
  ],
  templateUrl: './projects-page.component.html',
  styleUrl: './projects-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsPageComponent {
  private readonly _projects = inject(ProjectService);

  protected readonly projects = this._projects.orderedProjects;

  // Local form state for the inline "new project" panel.
  protected readonly showForm = signal(false);
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly creating = signal(false);

  protected openForm(): void {
    this.name.set('');
    this.description.set('');
    this.showForm.set(true);
  }

  protected cancelForm(): void {
    this.showForm.set(false);
  }

  protected create(): void {
    const name = this.name().trim();
    if (name === '' || this.creating()) {
      return;
    }
    this.creating.set(true);
    // The service handles encryption + persistence and navigates to the new
    // project's detail page on success, which tears down this component.
    this._projects.newProject$.next({
      version: '1',
      name,
      description: this.description().trim(),
    });
  }
}
