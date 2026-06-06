import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VaultService } from '../../services/vault.service';
import { VaultPasswordDialogComponent } from './vault-password-dialog.component';

describe('VaultPasswordDialogComponent', () => {
  let fixture: ComponentFixture<VaultPasswordDialogComponent>;
  let component: VaultPasswordDialogComponent;

  const unlockError = signal<string | null>(null);
  const generatedAccountKey = signal<string | null>(null);
  const wasLocked = signal(false);
  const unlockRequest$ = { next: vi.fn() };
  const clearUnlockError = vi.fn();

  beforeEach(async () => {
    unlockError.set(null);
    generatedAccountKey.set(null);
    wasLocked.set(false);
    unlockRequest$.next.mockReset();
    clearUnlockError.mockReset();

    await TestBed.configureTestingModule({
      imports: [VaultPasswordDialogComponent],
      providers: [
        {
          provide: VaultService,
          useValue: {
            generatedAccountKey,
            isNewKeyPair: signal(false),
            wasLocked,
            unlockError,
            unlockRequest$,
            clearUnlockError,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VaultPasswordDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the unlock error inside the dialog', () => {
    component.vaultForm.controls.accountPassword.setValue('incorrect-password');
    unlockError.set('Incorrect backup password');

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Incorrect backup password');
  });

  it('shows a locked title when the account was explicitly locked', () => {
    wasLocked.set(true);

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Account locked on this device',
    );
  });

  it('clears the unlock error before submitting unlock details', () => {
    component.vaultForm.controls.accountPassword.setValue('correct horse battery');
    component.vaultForm.controls.accountKey.setValue('test-account-key');

    component.submit();

    expect(clearUnlockError).toHaveBeenCalledTimes(1);
    expect(unlockRequest$.next).toHaveBeenCalledWith({
      accountKey: 'test-account-key',
      accountPassword: 'correct horse battery',
      trustDevice: true,
    });
  });
});
