import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Analytics } from '@app/services/analytics/analytics';
import { AuthService } from '@app/services/auth.service';

import { EarlyHabit } from './early-habit';

describe('EarlyHabit', () => {
  let fixture: ComponentFixture<EarlyHabit>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EarlyHabit],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { user: signal({ id: 'account-a' }) } },
        { provide: Analytics, useValue: { track: vi.fn(), page: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EarlyHabit);
    fixture.detectChanges();
  });

  it('renders no more than three content-blind suggestions', () => {
    expect(fixture.nativeElement.querySelectorAll('li')).toHaveLength(3);
    expect(fixture.nativeElement.textContent).not.toContain('message content');
  });
});
