import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Subject } from 'rxjs';

import { Translation, TranslocoTestingModule } from '@jsverse/transloco';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrganisationService } from '@app/services/organisation.service';
import { ProjectService } from '@app/services/project.service';
import {
  buildOrgBillingContextStub,
  stubOrgBillingContext,
} from '@app/testing/stub-org-billing-context';

import en from '../../../assets/i18n/en.json';
import { ProjectsPageComponent } from './projects-page.component';

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
  let projectCreateFailed$: Subject<void>;
  let newProjectNext: ReturnType<typeof vi.fn>;
  const workspaces: WorkspaceState = { hasMemberships: false, activeOrg: null };

  async function mount(
    orgBillingStub = stubOrgBillingContext,
  ): Promise<ComponentFixture<ProjectsPageComponent>> {
    TestBed.resetTestingModule();
    projectCreateFailed$ = new Subject<void>();
    newProjectNext = vi.fn();
    workspaces.hasMemberships = false;
    workspaces.activeOrg = null;

    await TestBed.configureTestingModule({
      imports: [ProjectsPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ProjectService,
          useValue: {
            orderedProjects: () => [],
            projectCreateFailed$,
            newProject$: { next: newProjectNext },
          },
        },
        orgBillingStub,
        {
          provide: OrganisationService,
          useValue: {
            visibleProjects: <T>(projects: T) => projects,
            hasMemberships: () => workspaces.hasMemberships,
            activeOrg: () => workspaces.activeOrg,
            memberships: () =>
              workspaces.activeOrg
                ? [
                    {
                      id: workspaces.activeOrg.id,
                      name: workspaces.activeOrg.name,
                      role: 'owner' as const,
                    },
                  ]
                : [],
            orgName: (orgId: string) =>
              workspaces.activeOrg?.id === orgId ? workspaces.activeOrg.name : null,
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

    return TestBed.createComponent(ProjectsPageComponent);
  }

  beforeEach(async () => {
    fixture = await mount();
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const badge = (): HTMLElement | null =>
    el().querySelector('[data-testid="workspace-context-badge"]');
  const billingHint = (): HTMLElement | null =>
    el().querySelector('[data-testid="projects-create-billing-hint"]');
  const createButton = (): HTMLButtonElement | null =>
    el().querySelector('button[type="submit"]');
  const setProjectName = (value: string): void => {
    (
      fixture.componentInstance as unknown as { name: { set: (v: string) => void } }
    ).name.set(value);
  };

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

  it('shows the org billing banner and disables create when writes are blocked (rainy)', async () => {
    fixture = await mount(
      buildOrgBillingContextStub({
        blocked: true,
        block: {
          code: 'ORG_BILLING_INACTIVE',
          organisationId: 'org_1',
          organisationName: 'Acme',
          message: '',
          adminMessage: '',
        },
      }),
    );
    workspaces.hasMemberships = true;
    workspaces.activeOrg = { id: 'org_1', name: 'Acme' };
    fixture.detectChanges();

    setProjectName('Blocked attempt');
    fixture.detectChanges();

    expect(el().querySelector('app-org-billing-banner')).not.toBeNull();
    expect(el().textContent).toContain('Acme billing is paused');
    expect(createButton()?.disabled).toBe(true);
    expect(
      el().querySelector('fieldset.projects-page__fields')?.hasAttribute('disabled'),
    ).toBe(true);
  });

  it('allows create when billing is healthy (sunny)', async () => {
    fixture = await mount(buildOrgBillingContextStub({ blocked: false }));
    fixture.detectChanges();

    setProjectName('Launch plan');
    fixture.detectChanges();

    expect(createButton()?.disabled).toBe(false);
    expect(el().querySelector('app-org-billing-banner')).toBeNull();
  });

  it('resets creating when project creation fails (rainy)', async () => {
    fixture.detectChanges();
    setProjectName('Launch plan');
    fixture.detectChanges();
    createButton()?.click();
    fixture.detectChanges();
    expect(el().textContent).toContain('Creating…');

    projectCreateFailed$.next();
    fixture.detectChanges();

    expect(el().textContent).not.toContain('Creating…');
    expect(createButton()?.disabled).toBe(false);
  });

  it('does not submit create when org writes are blocked (edge)', async () => {
    fixture = await mount(
      buildOrgBillingContextStub({
        blocked: true,
        block: {
          code: 'ORG_BILLING_PAST_DUE',
          organisationId: 'org_1',
          organisationName: 'Acme',
          message: '',
          adminMessage: '',
        },
      }),
    );
    fixture.detectChanges();

    setProjectName('Should not send');
    fixture.detectChanges();
    createButton()?.click();
    fixture.detectChanges();

    expect(newProjectNext).not.toHaveBeenCalled();
  });
});
