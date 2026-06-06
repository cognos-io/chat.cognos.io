import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CognosToastService } from '@cognos/ui-angular';

import { VaultService } from '../../services/vault.service';
import { VaultPasswordDialogComponent } from './vault-password-dialog.component';

describe('VaultPasswordDialogComponent', () => {
  let fixture: ComponentFixture<VaultPasswordDialogComponent>;
  let component: VaultPasswordDialogComponent;

  const unlockError = signal<string | null>(null);
  const generatedAccountKey = signal<string | null>(null);
  const isNewKeyPair = signal(false);
  const wasLocked = signal(false);
  const unlockRequest$ = { next: vi.fn() };
  const clearUnlockError = vi.fn();
  const toastService = { notify: vi.fn() };

  beforeEach(async () => {
    unlockError.set(null);
    generatedAccountKey.set(null);
    isNewKeyPair.set(false);
    wasLocked.set(false);
    unlockRequest$.next.mockReset();
    clearUnlockError.mockReset();
    toastService.notify.mockReset();

    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    await TestBed.configureTestingModule({
      imports: [VaultPasswordDialogComponent],
      providers: [
        {
          provide: VaultService,
          useValue: {
            generatedAccountKey,
            isNewKeyPair,
            wasLocked,
            unlockError,
            unlockRequest$,
            clearUnlockError,
          },
        },
        {
          provide: CognosToastService,
          useValue: toastService,
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

  it('requires the full Account Key acknowledgement before creating a backup', () => {
    isNewKeyPair.set(true);
    generatedAccountKey.set('ABCD-EF12-3456-7890');
    fixture.detectChanges();

    component.vaultForm.controls.accountPassword.setValue('correct horse battery');
    fixture.detectChanges();

    const submitButton = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;

    expect(fixture.nativeElement.textContent).toContain(
      'I have copied my Account Key to a safe place and acknowledge that if I lose it I will also not be able to access my account.',
    );
    expect(submitButton.disabled).toBe(true);

    component.vaultForm.controls.accountKeySaved.setValue(true);
    fixture.detectChanges();

    expect(submitButton.disabled).toBe(false);
  });

  it('shows a toast after copying the Account Key', async () => {
    isNewKeyPair.set(true);
    generatedAccountKey.set('ABCD-EF12-3456-7890');
    fixture.detectChanges();

    await component.copyAccountKey();

    expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledWith(
      'ABCD-EF12-3456-7890',
    );
    expect(toastService.notify).toHaveBeenCalledWith({
      title: 'Account Key copied',
      msg: 'Store it somewhere safe before you continue.',
      tone: 'success',
      icon: 'copy',
      duration: 3200,
    });
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
