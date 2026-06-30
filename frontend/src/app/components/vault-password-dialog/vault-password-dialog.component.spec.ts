import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { CognosToastService } from '@cognos/ui-angular';

import { LanguageService } from '../../services/language.service';
import { VaultService } from '../../services/vault.service';
import {
  VaultPasswordDialogComponent,
  buildEmergencyKitText,
} from './vault-password-dialog.component';

describe('buildEmergencyKitText', () => {
  const key = 'ABCD-EF12-3456-7890'; // gitleaks:allow — fake test value

  it('includes the Account Key verbatim', () => {
    expect(buildEmergencyKitText(key)).toContain(key);
  });

  it('explains it is the sole decryption/recovery key and is unrecoverable', () => {
    const text = buildEmergencyKitText(key).toLowerCase();
    expect(text).toContain('account key');
    expect(text).toContain('decrypt');
    // The whole point of the kit: losing it means the data is gone.
    expect(text).toContain('cannot be recovered');
  });

  it('includes the email when provided and omits the label when not', () => {
    expect(buildEmergencyKitText(key, 'person@example.com')).toContain(
      'person@example.com',
    );
    expect(buildEmergencyKitText(key)).not.toContain('Account:');
  });
});

describe('VaultPasswordDialogComponent', () => {
  let fixture: ComponentFixture<VaultPasswordDialogComponent>;
  let component: VaultPasswordDialogComponent;
  // Saved so the faked navigator.clipboard never leaks into other spec files
  // that share this worker's global scope.
  let originalClipboardDescriptor: PropertyDescriptor | undefined;

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

    originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      'clipboard',
    );
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    await TestBed.configureTestingModule({
      imports: [VaultPasswordDialogComponent],
      providers: [
        provideRouter([]),
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
        {
          // The embedded language switcher only needs these; stubbing avoids
          // constructing the real LanguageService → AuthService chain.
          provide: LanguageService,
          useValue: {
            currentLanguage: signal({
              code: 'en',
              nativeName: 'English',
              englishName: 'English',
            }),
            languages: [{ code: 'en', nativeName: 'English', englishName: 'English' }],
            use: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VaultPasswordDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    if (originalClipboardDescriptor) {
      Object.defineProperty(
        globalThis.navigator,
        'clipboard',
        originalClipboardDescriptor,
      );
    } else {
      Reflect.deleteProperty(globalThis.navigator, 'clipboard');
    }
  });

  it('renders the unlock error inside the dialog', () => {
    component.vaultForm.controls.accountKey.setValue('wrong-account-key');
    unlockError.set('Incorrect backup password');

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Incorrect backup password');
  });

  it('offers a log out action that routes to the logout flow', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const logoutButton = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((el) => (el as HTMLElement).textContent?.trim() === 'Log out') as
      | HTMLButtonElement
      | undefined;

    expect(logoutButton).toBeTruthy();

    component.logOut();

    expect(navigate).toHaveBeenCalledWith(['', 'auth', 'logout']);
  });

  it('hides the Account Key in a password field by default and reveals it on toggle', () => {
    const keyInput = () =>
      fixture.nativeElement.querySelector('#account-key') as HTMLInputElement;

    // A real password input: recovery-grade secret material must not be saved to
    // the browser's plaintext autofill history or offered in a suggestion drop-down.
    expect(keyInput().type).toBe('password');

    const revealButton = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((el) => (el as HTMLElement).textContent?.trim() === 'Show') as
      | HTMLButtonElement
      | undefined;
    expect(revealButton).toBeTruthy();

    revealButton!.click();
    fixture.detectChanges();

    // Show flips it to a plain text field so the user can verify a paste.
    expect(keyInput().type).toBe('text');
    expect(component.showAccountKey()).toBe(true);
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

    const submitButton = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;

    expect(fixture.nativeElement.textContent).toContain(
      'I have copied my Account Key to a safe place and understand that if I lose it, Cognos cannot recover my encrypted chats.',
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

  it('reassures users that unlock survives refresh and new tabs', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'this browser stays unlocked across refreshes and new tabs',
    );
  });

  it('keeps the Account Key field readonly until focus and disables autocomplete', () => {
    const accountKeyInput = fixture.nativeElement.querySelector(
      '#account-key',
    ) as HTMLInputElement;

    expect(accountKeyInput.autocomplete).toBe('off');
    expect(accountKeyInput.readOnly).toBe(true);

    accountKeyInput.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();

    expect(accountKeyInput.readOnly).toBe(false);
  });

  it('asks for the Account Key only at unlock, with no password field', () => {
    // The Account Key alone unlocks the backup, so there is no password input.
    expect(fixture.nativeElement.querySelector('#account-password')).toBeNull();
    expect(fixture.nativeElement.querySelector('#account-key')).not.toBeNull();
  });

  it('unlocks with the Account Key alone (no password needed)', () => {
    component.vaultForm.controls.accountKey.setValue('test-account-key');

    // The form is valid with just the key because the password is not part of it.
    expect(component.vaultForm.valid).toBe(true);

    component.submit();

    expect(unlockRequest$.next).toHaveBeenCalledWith({
      accountKey: 'test-account-key',
      trustDevice: true,
    });
  });

  it('clears the unlock error before submitting unlock details', () => {
    component.vaultForm.controls.accountKey.setValue('test-account-key');

    component.submit();

    expect(clearUnlockError).toHaveBeenCalledTimes(1);
    expect(unlockRequest$.next).toHaveBeenCalledWith({
      accountKey: 'test-account-key',
      trustDevice: true,
    });
  });
});
