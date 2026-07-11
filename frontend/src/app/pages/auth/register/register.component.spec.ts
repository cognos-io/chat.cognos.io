import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { Observable, Subject, of, throwError } from 'rxjs';

import { AuthService } from '@services/auth.service';

import { RegisterComponent } from './register.component';

describe('RegisterComponent', () => {
  let fixture: ComponentFixture<RegisterComponent>;
  let component: RegisterComponent;
  let router: Router;
  let user$: Subject<unknown>;

  const registerSpy = vi.fn<(email: string, password: string) => Observable<unknown>>();

  beforeEach(async () => {
    registerSpy.mockReset();
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

  it('requires a password of at least 12 characters', () => {
    component.registerForm.setValue({
      email: 'person@example.com',
      password: 'eleven-char', // 11 chars
    });
    expect(component.registerForm.invalid).toBe(true);

    component.registerForm.controls.password.setValue('twelve-chars'); // 12 chars
    expect(component.registerForm.valid).toBe(true);
  });

  it('submits registration when the form is valid', () => {
    registerSpy.mockReturnValue(of(undefined));
    component.registerForm.setValue({
      email: 'person@example.com',
      password: 'correct horse battery staple',
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
        password: 'correct horse battery staple',
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
    user$.next({ id: 'user-1', email: 'person@example.com' });

    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });
});
