import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OffboardMemberDialogComponent,
  OffboardMemberDialogData,
} from './offboard-member-dialog.component';

describe('OffboardMemberDialogComponent', () => {
  let fixture: ComponentFixture<OffboardMemberDialogComponent>;
  let closeSpy: ReturnType<typeof vi.fn>;

  function render(data: OffboardMemberDialogData) {
    closeSpy = vi.fn();
    TestBed.configureTestingModule({
      imports: [OffboardMemberDialogComponent],
      providers: [
        { provide: DialogRef, useValue: { close: closeSpy } },
        { provide: DIALOG_DATA, useValue: data },
      ],
    });

    fixture = TestBed.createComponent(OffboardMemberDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the member name and org name in the dialog', () => {
    render({ memberName: 'Sophie Müller', orgName: 'Acme Legal' });

    expect(fixture.nativeElement.textContent).toContain('Remove Sophie Müller?');
    expect(fixture.nativeElement.textContent).toContain(
      'They will immediately lose access to everything in Acme Legal.',
    );
  });

  it('closes with false when cancel is clicked', () => {
    render({ memberName: 'A', orgName: 'B' });

    fixture.nativeElement.querySelector('cog-button[appearance="subtle"]').click();

    expect(closeSpy).toHaveBeenCalledWith(false);
  });

  it('closes with true when confirm is clicked', () => {
    render({ memberName: 'A', orgName: 'B' });

    fixture.nativeElement.querySelector('cog-button[appearance="danger"]').click();

    expect(closeSpy).toHaveBeenCalledWith(true);
  });
});
