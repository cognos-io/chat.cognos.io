import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';

import { CognosToastService } from '@cognos/ui-angular';

import { Project, ProjectParticipantRecord } from '@app/interfaces/project';
import { AuthService } from '@app/services/auth.service';
import { CognosApiService } from '@app/services/cognos-api.service';
import { OrganisationService } from '@app/services/organisation.service';
import { ProjectSharingService } from '@app/services/project-sharing.service';

import { ProjectMembersComponent } from './project-members.component';

// Pins name resolution for the "you" row (issue: the sole participant of an
// org project rendered as a raw PocketBase record id). The org member list is
// gated to org Owners/Admins server-side, so a PLAIN member's own row must
// resolve through the signed-in account record instead.
describe('ProjectMembersComponent', () => {
  let fixture: ComponentFixture<ProjectMembersComponent>;

  const myUserId = 'oplnr8u3nlij1rq';
  const participant: ProjectParticipantRecord = {
    id: 'participant_1',
    user_id: myUserId,
    role: 'Admin',
  };

  const project = {
    record: {
      id: 'proj_1',
      organisation: 'org_1',
      creator: myUserId,
      caller_role: 'Admin',
    },
    decryptedData: { name: 'Client memos' },
    contentKey: new Uint8Array(32),
  } as unknown as Project;

  async function setup(user: Record<string, unknown>): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ProjectMembersComponent],
      providers: [
        {
          provide: ProjectSharingService,
          useValue: { listParticipants: () => of([participant]) },
        },
        {
          provide: CognosApiService,
          useValue: {
            // A plain org member may not read the member list — the 403 must
            // not leave the current user rendered as a record id.
            listOrgMembers: () => throwError(() => new Error('403')),
          },
        },
        {
          provide: OrganisationService,
          useValue: {
            memberships: () => [{ id: 'org_1', name: 'Acme', role: 'member' }],
            orgName: () => 'Acme',
          },
        },
        { provide: AuthService, useValue: { user: () => user } },
        { provide: Dialog, useValue: { open: vi.fn() } },
        { provide: CognosToastService, useValue: { notify: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectMembersComponent);
    fixture.componentRef.setInput('project', project);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const nameCell = (): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector('.project-members__name');
  const emailCell = (): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector('.project-members__email');

  it('renders the current user by email when the member list is unavailable', async () => {
    await setup({ id: myUserId, email: 'nils@example.com' });

    expect(nameCell()?.textContent).toContain('nils@example.com');
    expect(nameCell()?.textContent).not.toContain(myUserId);
  });

  it('prefers the current user display name, keeping the email underneath', async () => {
    await setup({
      id: myUserId,
      display_name: 'Nils Baumann',
      email: 'nils@example.com',
    });

    expect(nameCell()?.textContent).toContain('Nils Baumann');
    expect(nameCell()?.textContent).not.toContain(myUserId);
    expect(emailCell()?.textContent).toContain('nils@example.com');
  });

  it('falls back to the record id only for OTHER unresolvable participants', async () => {
    // Signed in as someone else: the row belongs to a different account whose
    // name genuinely cannot be resolved without the org member list.
    await setup({ id: 'someone_else', email: 'other@example.com' });

    expect(nameCell()?.textContent).toContain(myUserId);
  });
});
