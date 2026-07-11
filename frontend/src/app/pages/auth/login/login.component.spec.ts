import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { Subject } from 'rxjs';

import { ErrorService } from '@app/services/error.service';

import { AuthService, LoginStatus } from '@services/auth.service';

import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let router: Router;
  let user$: Subject<unknown>;

  const status = signal<LoginStatus>('pending');
  const loginNext = vi.fn();
  const errorService = {
    alert: vi.fn(),
  };

  beforeEach(async () => {
    status.set('pending');
    loginNext.mockReset();
    errorService.alert.mockReset();
    user$ = new Subject<unknown>();

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            status,
            user$,
            login$: { next: loginNext },
          },
        },
        { provide: ErrorService, useValue: errorService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  });

  afterEach(() => {
    user$.complete();
    vi.restoreAllMocks();
  });

  it('renders register and forgot-password links', () => {
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('a'),
      (link: HTMLAnchorElement) => link.textContent?.trim(),
    );

    expect(links).toContain('Forgot your password?');
    expect(links).toContain('Register');
    // Password reset is enabled now (the password is auth-only), so the old
    // "temporarily unavailable" notice must be gone.
    expect(fixture.nativeElement.textContent).not.toContain(
      'Password reset is temporarily unavailable',
    );
  });

  it('uses login wording and separate working legal links', () => {
    const legal = fixture.nativeElement.querySelector('.auth-page__legal');
    const links = Array.from(
      legal.querySelectorAll('a'),
      (link: HTMLAnchorElement) => link.href,
    );

    expect(legal.textContent).toContain('By continuing');
    expect(legal.textContent).not.toContain('By signing up');
    expect(links).toEqual(['https://cognos.io/terms', 'https://cognos.io/privacy']);
  });

  it('submits login credentials when the form is valid', () => {
    component.loginForm.setValue({
      email: 'person@example.com',
      password: 'correct horse battery staple',
    });

    component.onSubmit();

    expect(loginNext).toHaveBeenCalledWith({
      email: 'person@example.com',
      password: 'correct horse battery staple',
    });
  });

  it('does not submit while authentication is in progress', () => {
    component.loginForm.setValue({
      email: 'person@example.com',
      password: 'correct horse battery staple',
    });
    status.set('authenticating');
    fixture.detectChanges();

    component.onSubmit();

    expect(loginNext).not.toHaveBeenCalled();
  });

  it('navigates home after a user is emitted', () => {
    user$.next({ id: 'user-1', email: 'person@example.com' });

    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });
});
