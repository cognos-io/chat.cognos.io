import { TestBed } from '@angular/core/testing';

import { Subject, of } from 'rxjs';

import { THEME_STORAGE_KEY } from '@app/theme/theme';

import { AuthService } from './auth.service';
import { ThemeService } from './theme.service';

// A controllable MediaQueryList stand-in so tests can flip the device
// colour-scheme preference and fire `change` events on demand.
class FakeMediaQueryList {
  matches = false;
  private listeners: ((event: MediaQueryListEvent) => void)[] = [];

  addEventListener(
    _type: 'change',
    listener: (event: MediaQueryListEvent) => void,
  ): void {
    this.listeners.push(listener);
  }

  removeEventListener(
    _type: 'change',
    listener: (event: MediaQueryListEvent) => void,
  ): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  emit(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) {
      listener({ matches } as MediaQueryListEvent);
    }
  }
}

describe('ThemeService', () => {
  let media: FakeMediaQueryList;
  let user$: Subject<Record<string, unknown> | null>;
  let store: Map<string, string>;
  let setPreferredTheme: ReturnType<typeof vi.fn>;
  let currentUser: Record<string, unknown> | null;

  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  const makeService = (): ThemeService => {
    TestBed.configureTestingModule({
      providers: [
        ThemeService,
        {
          provide: AuthService,
          useValue: {
            user$,
            user: () => currentUser,
            setPreferredTheme,
          },
        },
      ],
    });
    return TestBed.inject(ThemeService);
  };

  beforeEach(() => {
    media = new FakeMediaQueryList();
    user$ = new Subject();
    currentUser = null;
    setPreferredTheme = vi.fn(() => of({}));

    store = new Map();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        get length() {
          return store.size;
        },
        clear: () => store.clear(),
        getItem: (key: string) => store.get(key) ?? null,
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        removeItem: (key: string) => void store.delete(key),
        setItem: (key: string, value: string) => void store.set(key, value),
      } satisfies Storage,
    });

    vi.stubGlobal('matchMedia', (query: string) => {
      expect(query).toBe('(prefers-color-scheme: dark)');
      return media as unknown as MediaQueryList;
    });

    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  const dom = () => ({
    attr: document.documentElement.getAttribute('data-theme'),
    colorScheme: document.documentElement.style.colorScheme,
  });

  it('system resolves to dark when the device prefers dark', () => {
    media.matches = true;
    const service = makeService();
    service.init();

    expect(service.preference()).toBe('system');
    expect(service.resolvedTheme()).toBe('dark');
    expect(dom()).toEqual({ attr: 'dark', colorScheme: 'dark' });
  });

  it('system resolves to light when the device does not prefer dark', () => {
    media.matches = false;
    const service = makeService();
    service.init();

    expect(service.resolvedTheme()).toBe('light');
    expect(dom()).toEqual({ attr: 'light', colorScheme: 'light' });
  });

  it('system resolves to light when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    const service = makeService();
    service.init();

    expect(service.resolvedTheme()).toBe('light');
  });

  it('updates live on device changes while preference is system', () => {
    const service = makeService();
    service.init();
    expect(service.resolvedTheme()).toBe('light');

    media.emit(true);
    expect(service.resolvedTheme()).toBe('dark');
    expect(dom().attr).toBe('dark');

    media.emit(false);
    expect(service.resolvedTheme()).toBe('light');
  });

  it('ignores device changes once an explicit theme is chosen', () => {
    const service = makeService();
    service.init();

    service.use('light');
    expect(service.resolvedTheme()).toBe('light');

    media.emit(true);
    expect(service.resolvedTheme()).toBe('light');
    expect(dom().attr).toBe('light');
  });

  it('persists the preference — not the resolved theme — to localStorage', () => {
    media.matches = true; // system would resolve to dark
    const service = makeService();
    service.init();

    service.use('system');
    // No-op (already system) leaves the store untouched by an explicit write,
    // so choose dark explicitly and confirm the *preference* is stored.
    service.use('dark');
    expect(store.get(THEME_STORAGE_KEY)).toBe('dark');

    service.use('system');
    expect(store.get(THEME_STORAGE_KEY)).toBe('system');
    // Even though system currently resolves to dark, we stored "system".
    expect(service.resolvedTheme()).toBe('dark');
  });

  it('reads a stored preference on init', () => {
    store.set(THEME_STORAGE_KEY, 'dark');
    const service = makeService();
    service.init();

    expect(service.preference()).toBe('dark');
    expect(service.resolvedTheme()).toBe('dark');
  });

  it('adopts the account preference when the user signs in', async () => {
    const service = makeService();
    service.init();
    expect(service.preference()).toBe('system');

    currentUser = { id: 'u1', preferred_theme: 'dark' };
    user$.next(currentUser);
    await flush();

    expect(service.preference()).toBe('dark');
    expect(setPreferredTheme).not.toHaveBeenCalled();
  });

  it('captures the local preference when the account has none', async () => {
    store.set(THEME_STORAGE_KEY, 'light');
    const service = makeService();
    service.init();

    currentUser = { id: 'u1' };
    user$.next(currentUser);
    await flush();

    expect(setPreferredTheme).toHaveBeenCalledWith('light');
  });

  it('saves the account preference on a user-initiated change', () => {
    currentUser = { id: 'u1', preferred_theme: 'system' };
    const service = makeService();
    service.init();

    service.use('dark');
    expect(setPreferredTheme).toHaveBeenCalledWith('dark');
  });
});
