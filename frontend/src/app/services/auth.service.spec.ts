import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import PocketBase from 'pocketbase';

import { lastValueFrom } from 'rxjs';

import { AuthService } from './auth.service';
import { ErrorService } from './error.service';
import { TrustedUnlockService } from './trusted-unlock.service';

describe('AuthService', () => {
  let service: AuthService;
  let router: Router;
  let authChangeHandler:
    | ((token: string, model: Record<string, unknown> | null) => void)
    | undefined;

  const authWithPassword = vi.fn();
  const authRefresh = vi.fn();
  const create = vi.fn();
  const send = vi.fn();
  const clear = vi.fn();
  const onChange = vi.fn(
    (callback: (token: string, model: Record<string, unknown> | null) => void) => {
      authChangeHandler = callback;
      return vi.fn();
    },
  );

  const errorService = {
    alert: vi.fn(),
  };

  const trustedUnlockService = {
    clearAllUnlockKeys: vi.fn(),
  };

  const authStore = {
    isValid: false,
    clear,
    onChange,
  };

  const pocketbase = {
    authStore,
    collection: vi.fn(() => ({
      authRefresh,
      authWithPassword,
      create,
    })),
    send,
  };

  const flushPromises = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    authChangeHandler = undefined;
    authStore.isValid = false;
    authWithPassword.mockReset();
    authRefresh.mockReset();
    create.mockReset();
    send.mockReset();
    clear.mockReset();
    onChange.mockClear();
    pocketbase.collection.mockClear();
    errorService.alert.mockReset();
    trustedUnlockService.clearAllUnlockKeys.mockReset();
    trustedUnlockService.clearAllUnlockKeys.mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        provideRouter([]),
        { provide: PocketBase, useValue: pocketbase },
        { provide: ErrorService, useValue: errorService },
        { provide: TrustedUnlockService, useValue: trustedUnlockService },
      ],
    });

    service = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('moves to the error state when login credentials are rejected', async () => {
    authWithPassword.mockRejectedValueOnce(new Error('invalid credentials'));

    service.login$.next({
      email: 'person@example.com',
      password: 'wrong password',
    });

    expect(service.status()).toBe('authenticating');

    await flushPromises();

    expect(authWithPassword).toHaveBeenCalledWith(
      'person@example.com',
      'wrong password',
    );
    expect(errorService.alert).toHaveBeenCalledWith('Invalid email or password');
    expect(service.status()).toBe('error');
    expect(service.user()).toBeNull();
    expect(service.email()).toBe('');
  });

  it('updates the auth state from a valid auth-store change event', () => {
    authStore.isValid = true;

    authChangeHandler?.('token-123', {
      id: 'user-1',
      email: 'person@example.com',
    });

    expect(service.status()).toBe('success');
    expect(service.email()).toBe('person@example.com');
    expect(service.user()).toEqual({
      id: 'user-1',
      email: 'person@example.com',
    });
  });

  it('redirects to logout when a stale session refresh returns 401', async () => {
    authRefresh.mockRejectedValueOnce({ status: 401 });

    authChangeHandler?.('expired-token', {
      id: 'user-1',
      email: 'person@example.com',
    });

    await flushPromises();

    expect(authRefresh).toHaveBeenCalledTimes(1);
    expect(errorService.alert).toHaveBeenCalledWith('Error refreshing auth token');
    expect(router.navigate).toHaveBeenCalledWith(['', 'auth', 'logout']);
  });

  it('creates the account and then signs in with the same credentials', async () => {
    create.mockResolvedValueOnce({ id: 'user-1' });
    authWithPassword.mockResolvedValueOnce({ token: 'token-123' });

    await expect(
      lastValueFrom(
        service.register('person@example.com', 'correct horse battery staple'),
      ),
    ).resolves.toEqual({ token: 'token-123' });

    expect(create).toHaveBeenCalledWith({
      email: 'person@example.com',
      password: 'correct horse battery staple',
      passwordConfirm: 'correct horse battery staple',
    });
    expect(authWithPassword).toHaveBeenCalledWith(
      'person@example.com',
      'correct horse battery staple',
    );
  });

  it('clears local unlock state and the auth store even if logout fails', async () => {
    send.mockRejectedValueOnce(new Error('network down'));

    await service.logout();

    expect(trustedUnlockService.clearAllUnlockKeys).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('/v1/auth/logout', { method: 'POST' });
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
