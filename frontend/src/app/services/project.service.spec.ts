import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { Subject, of, throwError } from 'rxjs';

import { describe, expect, it, vi } from 'vitest';

import { PERSONAL_WORKSPACE } from '@app/interfaces/organisation';
import { ProjectData } from '@app/interfaces/project';

import { AuthService } from './auth.service';
import { BillingService } from './billing.service';
import { CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { OrganisationService } from './organisation.service';
import { ProjectService } from './project.service';
import { VaultService } from './vault.service';

// Pins the workspace rule of project creation (spec §5.2): a project created
// while an ORG Workspace is active must be sent to the backend with that
// organisation id — otherwise the server stores it as a personal project and
// it silently vanishes from the org Workspace's filtered list.
describe('ProjectService', () => {
  let createProject: ReturnType<typeof vi.fn>;
  let workspace: string;
  let applyOrgBillingRestriction: ReturnType<typeof vi.fn>;

  const projectData: ProjectData = {
    version: '1',
    name: 'Client memos',
    description: '',
    icon: 'folder',
    color: 'blue',
    instructions: '',
    defaultModelId: '',
  };

  function setup(activeWorkspace: string): ProjectService {
    workspace = activeWorkspace;
    createProject = vi.fn().mockReturnValue(
      of({
        id: 'proj_1',
        data: 'ZW5j',
        wrapped_project_key: 'a2V5',
        caller_role: 'Admin',
      }),
    );
    applyOrgBillingRestriction = vi.fn().mockReturnValue(false);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { logout$: new Subject<void>() } },
        {
          provide: VaultService,
          useValue: {
            // Never emits: the fetch-on-unlock source stays quiet so the test
            // exercises the create path in isolation.
            keyPair$: new Subject(),
            keyPair: () => ({
              publicKey: new Uint8Array(32),
              secretKey: new Uint8Array(32),
            }),
          },
        },
        {
          provide: CryptoService,
          useValue: {
            randomKey: () => new Uint8Array(32),
            secretBox: () => new Uint8Array(8),
            createSealedBox: () => new Uint8Array(8),
          },
        },
        { provide: CognosApiService, useValue: { createProject } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: OrganisationService,
          useValue: {
            isOrgWorkspace: () => workspace !== PERSONAL_WORKSPACE,
            activeWorkspace: () => workspace,
          },
        },
        {
          provide: BillingService,
          useValue: {
            applyOrgBillingRestriction,
          },
        },
      ],
    });

    return TestBed.inject(ProjectService);
  }

  it('includes the organisation when an org Workspace is active', () => {
    const service = setup('org_123');

    service.newProject$.next(projectData);

    expect(createProject).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ organisation: 'org_123' }),
    );
  });

  it('omits the organisation field entirely in the personal Workspace', () => {
    const service = setup(PERSONAL_WORKSPACE);

    service.newProject$.next(projectData);

    expect(createProject).toHaveBeenCalledTimes(1);
    const request = createProject.mock.calls[0][0] as Record<string, unknown>;
    expect('organisation' in request).toBe(false);
    expect(Object.keys(request).sort()).toEqual(['data', 'wrapped_project_key']);
  });

  it('records an org billing block and emits projectCreateFailed$ on a 402', async () => {
    const service = setup('org_123');
    createProject.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 402,
            error: {
              data: {
                error: 'ORG_BILLING_INACTIVE',
                organisation_id: 'org_123',
                organisation_name: 'Acme',
              },
            },
          }),
      ),
    );
    applyOrgBillingRestriction.mockReturnValue(true);
    const failed: unknown[] = [];
    service.projectCreateFailed$.subscribe(() => failed.push(true));

    service.newProject$.next(projectData);

    await vi.waitFor(() => {
      expect(failed).toHaveLength(1);
    });
    expect(applyOrgBillingRestriction).toHaveBeenCalled();
  });

  it('does not call applyOrgBillingRestriction for non-billing errors (edge)', async () => {
    const service = setup('org_123');
    applyOrgBillingRestriction.mockReturnValue(false);
    createProject.mockReturnValue(throwError(() => new Error('network')));

    service.newProject$.next(projectData);

    await vi.waitFor(() => {
      expect(createProject).toHaveBeenCalled();
    });
    expect(applyOrgBillingRestriction).toHaveBeenCalled();
    expect(applyOrgBillingRestriction).toHaveReturnedWith(false);
  });
});
