import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WorkspaceContextBadgeComponent } from './workspace-context-badge.component';

describe('WorkspaceContextBadgeComponent', () => {
  let fixture: ComponentFixture<WorkspaceContextBadgeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkspaceContextBadgeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspaceContextBadgeComponent);
  });

  const badge = (): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="workspace-context-badge"]',
    );

  it('names the billed organisation for an org context', () => {
    fixture.componentRef.setInput('orgName', 'Acme Legal');
    fixture.detectChanges();

    expect(badge()?.textContent).toContain('Billed to Acme Legal');
    expect(badge()?.classList.contains('workspace-badge--org')).toBe(true);
  });

  it('marks the personal context as billed to the user', () => {
    fixture.componentRef.setInput('orgName', null);
    fixture.detectChanges();

    expect(badge()?.textContent).toContain('Personal — billed to you');
    expect(badge()?.classList.contains('workspace-badge--org')).toBe(false);
  });

  it('treats the default input as personal', () => {
    fixture.detectChanges();

    expect(badge()?.textContent).toContain('Personal — billed to you');
  });
});
