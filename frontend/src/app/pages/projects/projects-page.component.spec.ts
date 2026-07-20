import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Translation, TranslocoTestingModule } from '@jsverse/transloco';

import { OrganisationService } from '@app/services/organisation.service';
import { ProjectService } from '@app/services/project.service';

import en from '../../../assets/i18n/en.json';
import { ProjectsPageComponent } from './projects-page.component';

// The create-card billing keys are new and land in the i18n catalogs via a
// separate merge (see scratchpad/i18n-worker-B.md); until then the spec
// provides the same English values on top of the real catalog so the pins
// assert visible copy, not key paths.
const enWithBillingKeys = {
  ...(en as Record<string, unknown>),
  projects: {
    ...(en as unknown as { projects: Record<string, unknown> }).projects,
    createBilledToOrg: 'This project will be billed to {{ org }}',
    createBilledToYou: 'This project is personal — billed to you',
  },
} as unknown as Translation;

interface WorkspaceState {
  hasMemberships: boolean;
  activeOrg: { id: string; name: string } | null;
}

describe('ProjectsPageComponent', () => {
  let fixture: ComponentFixture<ProjectsPageComponent>;
  const workspaces: WorkspaceState = { hasMemberships: false, activeOrg: null };

  beforeEach(async () => {
    workspaces.hasMemberships = false;
    workspaces.activeOrg = null;

    await TestBed.configureTestingModule({
      imports: [ProjectsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ProjectService, useValue: { orderedProjects: () => [] } },
        {
          provide: OrganisationService,
          useValue: {
            visibleProjects: <T>(projects: T) => projects,
            hasMemberships: () => workspaces.hasMemberships,
            activeOrg: () => workspaces.activeOrg,
          },
        },
        importProvidersFrom(
          TranslocoTestingModule.forRoot({
            langs: { en: enWithBillingKeys },
            translocoConfig: {
              availableLangs: ['en'],
              defaultLang: 'en',
              fallbackLang: 'en',
              missingHandler: { useFallbackTranslation: true },
            },
            preloadLangs: true,
          }),
        ),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectsPageComponent);
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const badge = (): HTMLElement | null =>
    el().querySelector('[data-testid="workspace-context-badge"]');
  const billingHint = (): HTMLElement | null =>
    el().querySelector('[data-testid="projects-create-billing-hint"]');

  it('names the active organisation in the header badge and create card', () => {
    workspaces.hasMemberships = true;
    workspaces.activeOrg = { id: 'org_1', name: 'Vuille Tax Advisory' };
    fixture.detectChanges();

    expect(badge()?.textContent).toContain('Billed to Vuille Tax Advisory');
    expect(billingHint()?.textContent).toContain(
      'This project will be billed to Vuille Tax Advisory',
    );
  });

  it('marks the personal workspace as billed to the user', () => {
    workspaces.hasMemberships = true;
    workspaces.activeOrg = null;
    fixture.detectChanges();

    expect(badge()?.textContent).toContain('Personal — billed to you');
    expect(billingHint()?.textContent).toContain(
      'This project is personal — billed to you',
    );
  });

  it('shows no workspace context for accounts without org memberships', () => {
    fixture.detectChanges();

    expect(badge()).toBeNull();
    expect(billingHint()).toBeNull();
  });
});
