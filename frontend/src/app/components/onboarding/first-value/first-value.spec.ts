import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Analytics } from '@app/services/analytics/analytics';
import { AuthService } from '@app/services/auth.service';

import { FirstValue } from './first-value';

describe('FirstValue', () => {
  let component: FirstValue;
  let fixture: ComponentFixture<FirstValue>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FirstValue],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { user: signal({ id: 'account-a' }) } },
        { provide: Analytics, useValue: { track: vi.fn(), page: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FirstValue);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders as a labelled in-page region', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    const region = fixture.nativeElement.querySelector('section[aria-labelledby]');
    const heading = fixture.nativeElement.querySelector('h1');

    expect(region).toBeTruthy();
    expect(heading?.id).toBe(region?.getAttribute('aria-labelledby'));
  });

  it('selects a starter without sending it', () => {
    component.choose('draft');

    expect(component.journey.takeStarter()).toBe('draft');
  });
});
