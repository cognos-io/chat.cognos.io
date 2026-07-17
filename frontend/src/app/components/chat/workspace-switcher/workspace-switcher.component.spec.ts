import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { OrganisationRecord, WorkspaceId } from '@app/interfaces/organisation';
import { OrganisationService } from '@app/services/organisation.service';

import { WorkspaceSwitcherComponent } from './workspace-switcher.component';

const acme: OrganisationRecord = {
  id: 'org_acme',
  name: 'Acme Legal',
  role: 'member',
  created: '2026-07-01 00:00:00.000Z',
};

describe('WorkspaceSwitcherComponent', () => {
  let fixture: ComponentFixture<WorkspaceSwitcherComponent>;

  const memberships = signal<OrganisationRecord[]>([]);
  const activeWorkspace = signal<WorkspaceId>('personal');
  const setActiveWorkspace = vi.fn((workspace: WorkspaceId) => {
    activeWorkspace.set(workspace);
  });
  const router = { navigate: vi.fn(), navigateByUrl: vi.fn() };

  // Mirror the OrganisationService surface the component reads.
  const workspaces = {
    memberships,
    activeWorkspace,
    setActiveWorkspace,
    hasMemberships: () => memberships().length > 0,
    isOrgWorkspace: () => activeWorkspace() !== 'personal',
    activeOrg: () => memberships().find((org) => org.id === activeWorkspace()) ?? null,
  };

  beforeEach(async () => {
    memberships.set([]);
    activeWorkspace.set('personal');
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [WorkspaceSwitcherComponent],
      providers: [
        { provide: OrganisationService, useValue: workspaces },
        // Pinned below: switching must never navigate.
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspaceSwitcherComponent);
    fixture.detectChanges();
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const trigger = (): HTMLButtonElement | null =>
    el().querySelector('[data-testid="workspace-switcher-trigger"]');
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('renders nothing when the account has no memberships', () => {
    expect(trigger()).toBeNull();
    expect(el().textContent?.trim()).toBe('');
  });

  describe('with memberships', () => {
    beforeEach(() => {
      memberships.set([acme]);
      fixture.detectChanges();
    });

    it('shows the trigger with menu semantics and the Personal label', () => {
      const button = trigger();
      expect(button).not.toBeNull();
      expect(button?.getAttribute('aria-haspopup')).toBe('menu');
      expect(button?.getAttribute('aria-expanded')).toBe('false');
      expect(button?.getAttribute('aria-label')).toContain('Personal');
      expect(button?.textContent).toContain('Personal');
    });

    it('shows the org name when an org workspace is active', () => {
      activeWorkspace.set('org_acme');
      fixture.detectChanges();

      expect(trigger()?.textContent).toContain('Acme Legal');
    });

    it('opens the menu with Personal + each org as menu items', async () => {
      trigger()?.click();
      fixture.detectChanges();
      await flush();

      expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
      const items = el().querySelectorAll('[role="menuitem"]');
      expect(items).toHaveLength(2);
      expect(items[0].textContent).toContain('Personal');
      expect(items[1].textContent).toContain('Acme Legal');
      // Billing context is spelled out at the moment of switching.
      expect(items[1].textContent).toContain('Billed to Acme Legal');
      // Focus moves into the menu for keyboard users.
      expect(document.activeElement).toBe(items[0]);
    });

    it('selecting an org switches the workspace and closes the menu', async () => {
      trigger()?.click();
      fixture.detectChanges();
      await flush();

      const items = el().querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      items[1].click();
      fixture.detectChanges();

      expect(setActiveWorkspace).toHaveBeenCalledWith('org_acme');
      expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
      expect(el().querySelectorAll('[role="menuitem"]')).toHaveLength(0);
      // Focus returns to the trigger so keyboard users aren't dropped.
      expect(document.activeElement).toBe(trigger());
    });

    // Pin: switching workspace performs NO navigation. The composer keeps its
    // draft precisely because the switch is signals-only — the form component
    // is never destroyed (spec §5.2 "a draft message is never lost by
    // switching Workspace"). If this fails, a navigation crept into the
    // switch path and drafts WILL be lost — change it consciously.
    it('pin: switching never navigates (drafts survive)', async () => {
      trigger()?.click();
      fixture.detectChanges();
      await flush();

      el().querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1].click();
      fixture.detectChanges();

      expect(router.navigate).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('Escape closes the menu and restores focus to the trigger', async () => {
      trigger()?.click();
      fixture.detectChanges();
      await flush();

      el()
        .querySelector('.workspace-switcher')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();

      expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
      expect(el().querySelectorAll('[role="menuitem"]')).toHaveLength(0);
      expect(document.activeElement).toBe(trigger());
    });

    it('a click outside closes the menu', async () => {
      trigger()?.click();
      fixture.detectChanges();
      await flush();

      document.body.click();
      fixture.detectChanges();

      expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
    });
  });
});
