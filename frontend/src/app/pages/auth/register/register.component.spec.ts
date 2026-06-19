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

  it('clears the loading state when registration fails', () => {
    registerSpy.mockReturnValue(throwError(() => new Error('boom')));
    component.registerForm.setValue({
      email: 'person@example.com',
      password: 'correct horse battery staple',
    });

    component.onSubmit();

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(component.loading()).toBe(false);
  });

  it('navigates home after a user is emitted', () => {
    user$.next({ id: 'user-1', email: 'person@example.com' });

    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });
});
