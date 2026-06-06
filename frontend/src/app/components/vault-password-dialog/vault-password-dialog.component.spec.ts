import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VaultService } from '../../services/vault.service';
import { VaultPasswordDialogComponent } from './vault-password-dialog.component';

describe('VaultPasswordDialogComponent', () => {
  let fixture: ComponentFixture<VaultPasswordDialogComponent>;
  let component: VaultPasswordDialogComponent;

  const unlockError = signal<string | null>(null);
  const rawVaultPassword$ = { next: vi.fn() };
  const clearUnlockError = vi.fn();

  beforeEach(async () => {
    unlockError.set(null);
    rawVaultPassword$.next.mockReset();
    clearUnlockError.mockReset();

    await TestBed.configureTestingModule({
      imports: [VaultPasswordDialogComponent],
      providers: [
        {
          provide: VaultService,
          useValue: {
            isNewKeyPair: signal(false),
            unlockError,
            rawVaultPassword$,
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
    component.vaultPasswordForm.controls.vaultPassword.setValue('incorrect-password');
    unlockError.set('Incorrect vault password');

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Incorrect vault password');
  });

  it('clears the unlock error before submitting a vault password', () => {
    component.vaultPasswordForm.controls.vaultPassword.setValue(
      'correct horse battery',
    );

    component.submit();

    expect(clearUnlockError).toHaveBeenCalledTimes(1);
    expect(rawVaultPassword$.next).toHaveBeenCalledWith('correct horse battery');
  });
});
