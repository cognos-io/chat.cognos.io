import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Analytics } from './analytics/analytics';
import { AuthService } from './auth.service';
import { FirstValueJourney } from './first-value-journey';

describe('FirstValueJourney', () => {
  let service: FirstValueJourney;
  let track: ReturnType<typeof vi.fn>;
  let storage: Storage;

  beforeEach(() => {
    const values = new Map<string, string>();
    storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    };
    vi.stubGlobal('localStorage', storage);
    track = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { user: signal({ id: 'account-a' }) } },
        { provide: Analytics, useValue: { track, page: vi.fn() } },
      ],
    });
    service = TestBed.inject(FirstValueJourney);
  });

  it('stays hidden until the Account Key ceremony completes', () => {
    expect(service.visible()).toBe(false);

    service.markEligible();

    expect(service.visible()).toBe(true);
  });

  it('dismisses without producing a starter', () => {
    service.markEligible();

    service.dismiss();

    expect(service.visible()).toBe(false);
    expect(service.takeStarter()).toBeNull();
  });

  it('hands a selected starter to the composer exactly once', () => {
    service.markEligible();

    service.selectStarter('think');

    expect(service.visible()).toBe(false);
    expect(service.starterRevision()).toBe('think');
    expect(service.takeStarter()).toBe('think');
    expect(service.takeStarter()).toBeNull();
  });

  it('emits a content-free first-message milestone', () => {
    service.markEligible();
    service.recordConversationCreated();

    service.recordMessageSent();

    expect(track).toHaveBeenCalledWith('adoption_milestone', {
      milestone: 'first_message_24h',
    });
    const stored = storage.getItem('cognos:adoption:v1:account-a') ?? '';
    expect(stored).not.toContain('title');
    expect(stored).not.toContain('content');
  });
});
