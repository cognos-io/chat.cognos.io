import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DissolveOrganisationDialogComponent,
  DissolveOrganisationDialogData,
} from './dissolve-organisation-dialog.component';

describe('DissolveOrganisationDialogComponent', () => {
  let fixture: ComponentFixture<DissolveOrganisationDialogComponent>;
  let close: ReturnType<typeof vi.fn>;

  function render(data: DissolveOrganisationDialogData) {
    close = vi.fn();
    TestBed.configureTestingModule({
      imports: [DissolveOrganisationDialogComponent],
      providers: [
        { provide: DialogRef, useValue: { close } },
        { provide: DIALOG_DATA, useValue: data },
      ],
    });
    fixture = TestBed.createComponent(DissolveOrganisationDialogComponent);
    fixture.detectChanges();
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('plainly names every consequence and the untouched personal account', () => {
    render({ orgName: 'Acme Legal' });
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Dissolve Acme Legal?');
    expect(text).toContain(
      'This permanently deletes every Organisation Project and removes every member.',
    );
    expect(text).toContain(
      'The subscription will end at the end of the current billing cycle.',
    );
    expect(text).toContain('Your personal account and personal chats are untouched.');
  });

  it('does not confirm until the explicit deletion acknowledgement is checked', () => {
    render({ orgName: 'Acme' });
    const component = fixture.componentInstance;
    const confirm = fixture.nativeElement.querySelector(
      'cog-button[appearance="danger"]',
    );

    component.confirm();
    expect(close).not.toHaveBeenCalled();
    expect(confirm.getAttribute('ng-reflect-disabled')).not.toBe('false');

    const checkbox = fixture.nativeElement.querySelector('input[type="checkbox"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    component.confirm();

    expect(close).toHaveBeenCalledWith(true);
  });

  it('closes without confirmation from the cancel action', () => {
    render({ orgName: 'Acme' });
    fixture.nativeElement.querySelector('cog-button[appearance="subtle"]').click();
    expect(close).toHaveBeenCalledWith(false);
  });
});
