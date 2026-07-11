import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Observable, of, throwError } from 'rxjs';

import { AuthService } from '@services/auth.service';

import { ForgotPasswordComponent } from './forgot-password.component';

describe('ForgotPasswordComponent', () => {
  let fixture: ComponentFixture<ForgotPasswordComponent>;
  let component: ForgotPasswordComponent;
  const requestPasswordReset = vi.fn<(email: string) => Observable<unknown>>();

  beforeEach(async () => {
    requestPasswordReset.mockReset();
    await TestBed.configureTestingModule({
      imports: [ForgotPasswordComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { requestPasswordReset } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ForgotPasswordComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.forgotForm.controls.email.setValue('person@example.com');
  });

  it.each([
    [{ status: 400 }, 'Check the email address'],
    [{ status: 429 }, 'Too many reset requests'],
    [{ status: 0 }, "couldn't reach Cognos"],
    [{ status: 503 }, "couldn't send the reset link right now"],
  ])(
    'shows and focuses an actionable error when reset fails',
    async (error, message) => {
      requestPasswordReset.mockReturnValue(throwError(() => error));

      component.onSubmit();
      fixture.detectChanges();
      await new Promise<void>((resolve) => setTimeout(resolve));

      const alert = fixture.nativeElement.querySelector('[role="alert"]');
      expect(component.sending()).toBe(false);
      expect(alert.textContent).toContain(message);
      expect(document.activeElement).toBe(alert);
    },
  );

  it('clears an earlier failure and shows the enumeration-safe success state on retry', () => {
    requestPasswordReset.mockReturnValueOnce(throwError(() => ({ status: 503 })));
    component.onSubmit();
    requestPasswordReset.mockReturnValueOnce(of(undefined));

    component.onSubmit();
    fixture.detectChanges();

    expect(component.submitErrorKey()).toBe('');
    expect(component.sent()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain(
      'If an account exists for person@example.com',
    );
  });
});
