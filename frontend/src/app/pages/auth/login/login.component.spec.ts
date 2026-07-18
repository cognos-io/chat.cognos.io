import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

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
    // Deliberate pin update: post-auth navigation now goes through
    // navigateByUrl so a guard-provided ?next=… deep link can be honoured;
    // with no next present it still lands on home.
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    user$.next({ id: 'user-1', email: 'person@example.com' });

    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });
});

// Pins the second half of the deep-link contract (authGuard supplies ?next=…):
// after signing in the user must land on the guarded URL they originally
// asked for — and an off-site `next` must be ignored, never followed.
describe('LoginComponent post-auth next handling', () => {
  let user$: Subject<unknown>;
  let navigateByUrl: ReturnType<typeof vi.fn>;

  async function setup(loginUrl: string): Promise<void> {
    user$ = new Subject<unknown>();

    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'auth/login', component: LoginComponent }]),
        {
          provide: AuthService,
          useValue: {
            status: signal<LoginStatus>('pending'),
            user$,
            login$: { next: vi.fn() },
          },
        },
        { provide: ErrorService, useValue: { alert: vi.fn() } },
      ],
    });

    await RouterTestingHarness.create(loginUrl);

    // Record post-auth navigation without actually routing — the redirect
    // targets are not registered in this harness.
    navigateByUrl = vi.fn().mockResolvedValue(true);
    TestBed.inject(Router).navigateByUrl =
      navigateByUrl as unknown as Router['navigateByUrl'];
  }

  afterEach(() => {
    user$.complete();
  });

  it('returns to a safe internal next target after sign-in', async () => {
    await setup('/auth/login?next=%2Finvite%3Ftoken%3Dabc');

    user$.next({ id: 'user-1' });

    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/invite?token=abc');
  });

  it('ignores an external next target and lands on home', async () => {
    await setup('/auth/login?next=https:%2F%2Fevil.example%2Fphish');

    user$.next({ id: 'user-1' });

    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('ignores a scheme-relative next target', async () => {
    await setup('/auth/login?next=%2F%2Fevil.example');

    user$.next({ id: 'user-1' });

    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });
});
