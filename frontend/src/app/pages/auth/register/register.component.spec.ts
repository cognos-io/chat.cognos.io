import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { Observable, Subject, of, throwError } from 'rxjs';

import { AuthService, OAuthErrorKind } from '@services/auth.service';

import { RegisterComponent } from './register.component';

const SHORT_PASSWORD = 'eleven-char';
const TEST_PASSWORD = 'correct horse battery staple';

describe('RegisterComponent', () => {
  let fixture: ComponentFixture<RegisterComponent>;
  let component: RegisterComponent;
  let router: Router;
  let user$: Subject<unknown>;

  const registerSpy = vi.fn<(email: string, password: string) => Observable<unknown>>();
  const oauthError = signal<OAuthErrorKind | null>(null);
  const googleBusy = signal(false);
  const googleAvailable = signal(true);
  const loginWithGoogle = vi.fn();

  beforeEach(async () => {
    registerSpy.mockReset();
    oauthError.set(null);
    googleBusy.set(false);
    googleAvailable.set(true);
    loginWithGoogle.mockReset();
    user$ = new Subject<unknown>();

    await TestBed.configureTestingModule({
      imports: [RegisterComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            user$,
            register: registerSpy,
            oauthError,
            googleBusy,
            googleAvailable,
            loginWithGoogle,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  });

  afterEach(() => {
    user$.complete();
    vi.restoreAllMocks();
  });

  it('has no password-confirmation field (single password entry)', () => {
    expect(component.registerForm.contains('passwordConfirm')).toBe(false);
    expect(fixture.nativeElement.querySelector('#passwordConfirm')).toBeNull();
  });

  it('hides Google when PocketBase has no configured Google provider', () => {
    googleAvailable.set(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Continue with Google');
    expect(fixture.nativeElement.querySelector('.auth-page__divider')).toBeNull();
  });

  it('requires a password of at least 12 characters', () => {
    component.registerForm.setValue({
      email: 'person@example.com',
      password: SHORT_PASSWORD, // 11 chars
    });
    expect(component.registerForm.invalid).toBe(true);

    component.registerForm.controls.password.setValue('twelve-chars'); // 12 chars
    expect(component.registerForm.valid).toBe(true);
  });

  it('submits registration when the form is valid', () => {
    registerSpy.mockReturnValue(of(undefined));
    component.registerForm.setValue({
      email: 'person@example.com',
      password: TEST_PASSWORD,
    });

    component.onSubmit();

    expect(registerSpy).toHaveBeenCalledWith(
      'person@example.com',
      'correct horse battery staple',
    );
    expect(component.loading()).toBe(false);
  });

  it.each([
    [
      { status: 400, response: { data: { email: { code: 'validation_not_unique' } } } },
      'already uses this email',
    ],
    [{ status: 400 }, "couldn't create the account"],
    [{ status: 429 }, 'Too many signup attempts'],
    [{ status: 0 }, "couldn't reach Cognos"],
    [{ status: 503 }, "couldn't create your account right now"],
  ])(
    'shows and focuses an actionable error when registration fails',
    async (error, message) => {
      registerSpy.mockReturnValue(throwError(() => error));
      component.registerForm.setValue({
        email: 'person@example.com',
        password: TEST_PASSWORD,
      });

      component.onSubmit();

      expect(registerSpy).toHaveBeenCalledTimes(1);
      expect(component.loading()).toBe(false);
      fixture.detectChanges();
      await new Promise<void>((resolve) => setTimeout(resolve));
      const alert = fixture.nativeElement.querySelector('[role="alert"]');
      expect(alert.textContent).toContain(message);
      expect(document.activeElement).toBe(alert);
    },
  );

  it('links separately to the localised Terms and Privacy pages', () => {
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('.auth-page__legal a'),
      (link: HTMLAnchorElement) => link.href,
    );

    expect(links).toEqual(['https://cognos.io/terms', 'https://cognos.io/privacy']);
  });

  it('navigates home after a user is emitted', () => {
    // Deliberate pin update: post-auth navigation now goes through
    // navigateByUrl so a guard-provided ?next=… deep link survives the
    // sign-up detour; with no next present it still lands on home.
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    user$.next({ id: 'user-1', email: 'person@example.com' });

    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });
});
