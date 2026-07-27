import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import PocketBase from 'pocketbase';

import { lastValueFrom, of, throwError } from 'rxjs';

import { AuthService } from './auth.service';
import { CognosApiService } from './cognos-api.service';
import { ErrorService } from './error.service';
import { MfaService } from './mfa.service';
import { TrustedUnlockService } from './trusted-unlock.service';

const CORRECT_PASSWORD = 'correct-pw';
const NEW_PASSWORD = 'a-new-strong-pw';
const REGISTRATION_PASSWORD = 'correct horse battery staple';
const TEST_TOKEN = 'token-123';
const WRONG_PASSWORD = 'wrong password';

describe('AuthService', () => {
  let service: AuthService;
  let router: Router;
  let authChangeHandler:
    ((token: string, model: Record<string, unknown> | null) => void) | undefined;

  const authWithPassword = vi.fn();
  const authWithOAuth2 = vi.fn();
  const listAuthMethods = vi.fn();
  const authRefresh = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
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

  const mfaService = {
    deviceToken: vi.fn<(email: string) => string | null>(() => null),
    clearDeviceToken: vi.fn(),
    completeTotp: vi.fn(),
    completeRecovery: vi.fn(),
  };

  const cognosApiService = {
    getAccountAuthMethods: vi.fn(),
    createOAuthLinkIntent: vi.fn(),
    beginOAuthStepUp: vi.fn(),
    completeOAuthStepUp: vi.fn(),
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
      authWithOAuth2,
      listAuthMethods,
      create,
      update,
    })),
    send,
  };

  const flushPromises = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    authChangeHandler = undefined;
    authStore.isValid = false;
    authWithPassword.mockReset();
    authWithOAuth2.mockReset();
    listAuthMethods.mockReset();
    listAuthMethods.mockResolvedValue({
      oauth2: { enabled: true, providers: [{ name: 'google' }] },
    });
    authRefresh.mockReset();
    create.mockReset();
    update.mockReset();
    send.mockReset();
    clear.mockReset();
    onChange.mockClear();
    pocketbase.collection.mockClear();
    errorService.alert.mockReset();
    trustedUnlockService.clearAllUnlockKeys.mockReset();
    trustedUnlockService.clearAllUnlockKeys.mockResolvedValue(undefined);
    mfaService.deviceToken.mockReset();
    mfaService.deviceToken.mockReturnValue(null);
    mfaService.completeTotp.mockReset();
    mfaService.completeRecovery.mockReset();
    cognosApiService.getAccountAuthMethods.mockReset();
    cognosApiService.createOAuthLinkIntent.mockReset();
    cognosApiService.beginOAuthStepUp.mockReset();
    cognosApiService.completeOAuthStepUp.mockReset();

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        provideRouter([]),
        { provide: PocketBase, useValue: pocketbase },
        { provide: ErrorService, useValue: errorService },
        { provide: TrustedUnlockService, useValue: trustedUnlockService },
        { provide: MfaService, useValue: mfaService },
        { provide: CognosApiService, useValue: cognosApiService },
      ],
    });

    service = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('moves to the error state when login credentials are rejected', async () => {
    authWithPassword.mockRejectedValueOnce(new Error('invalid credentials'));

    service.login$.next({
      email: 'person@example.com',
      password: WRONG_PASSWORD,
    });

    expect(service.status()).toBe('authenticating');

    await flushPromises();

    expect(authWithPassword).toHaveBeenCalledWith(
      'person@example.com',
      'wrong password',
      undefined,
    );
    expect(errorService.alert).toHaveBeenCalledWith('Invalid email or password');
    expect(service.status()).toBe('error');
    expect(service.user()).toBeNull();
    expect(service.email()).toBe('');
  });

  it('challenges for a second factor when the backend requires MFA', async () => {
    // A correct password for an MFA-enrolled account is reported by PocketBase as
    // a 401 with our mfa_required body — not a credential error.
    authWithPassword.mockRejectedValueOnce({
      status: 401,
      response: { code: 'mfa_required', mfaSessionId: 'sess-1' },
    });

    service.login$.next({ email: 'person@example.com', password: CORRECT_PASSWORD });

    await flushPromises();

    expect(service.status()).toBe('mfa_required');
    expect(service.mfaSessionId()).toBe('sess-1');
    expect(service.email()).toBe('person@example.com');
    // It must NOT look like a failed login.
    expect(errorService.alert).not.toHaveBeenCalled();
  });

  it('presents a remembered trusted-device token on login', async () => {
    mfaService.deviceToken.mockReturnValue('device-token-1');
    authWithPassword.mockResolvedValueOnce({ token: 't', record: { id: 'u' } });

    service.login$.next({ email: 'person@example.com', password: CORRECT_PASSWORD });
    await flushPromises();

    expect(mfaService.deviceToken).toHaveBeenCalledWith('person@example.com');
    expect(authWithPassword).toHaveBeenCalledWith('person@example.com', 'correct-pw', {
      headers: { 'X-Cognos-MFA-Device': 'device-token-1' },
    });
  });

  it('completes a second factor via the MFA service with the active session', async () => {
    authWithPassword.mockRejectedValueOnce({
      status: 401,
      response: { code: 'mfa_required', mfaSessionId: 'sess-1' },
    });
    mfaService.completeTotp.mockReturnValue(
      of({ id: 'u', email: 'person@example.com' }),
    );

    service.login$.next({ email: 'person@example.com', password: CORRECT_PASSWORD });
    await flushPromises();

    await lastValueFrom(service.completeMfa('totp', '123456', true));

    expect(mfaService.completeTotp).toHaveBeenCalledWith(
      'sess-1',
      '123456',
      'person@example.com',
      true,
    );
  });

  it('rejects MFA completion when there is no active session', async () => {
    mfaService.completeTotp.mockReturnValue(
      throwError(() => new Error('should not be called')),
    );
    await expect(
      lastValueFrom(service.completeMfa('totp', '123456', false)),
    ).rejects.toThrow(/no active mfa session/i);
    expect(mfaService.completeTotp).not.toHaveBeenCalled();
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

  it('changes the password and re-authenticates to keep the session alive', async () => {
    authStore.isValid = true;
    authRefresh.mockResolvedValue({});
    update.mockResolvedValue({ id: 'user-1', email: 'person@example.com' });
    authWithPassword.mockResolvedValue({
      record: { id: 'user-1', email: 'person@example.com' },
    });

    authChangeHandler?.('token-123', { id: 'user-1', email: 'person@example.com' });

    await lastValueFrom(service.changePassword('old-pw', 'a-new-strong-pw'));

    // PocketBase verifies oldPassword and rotates the token; passwordConfirm
    // mirrors the new password since we already validated it client-side.
    expect(update).toHaveBeenCalledWith('user-1', {
      oldPassword: 'old-pw',
      password: NEW_PASSWORD,
      passwordConfirm: 'a-new-strong-pw',
    });
    // Re-auth with the new password refreshes the now-rotated token.
    expect(authWithPassword).toHaveBeenCalledWith(
      'person@example.com',
      'a-new-strong-pw',
    );
  });

  it('propagates the error and does not re-auth when the current password is wrong', async () => {
    authStore.isValid = true;
    authRefresh.mockResolvedValue({});
    update.mockRejectedValue(new Error('Failed to authenticate.'));

    authChangeHandler?.('token-123', { id: 'user-1', email: 'person@example.com' });

    await expect(
      lastValueFrom(service.changePassword('wrong-pw', 'a-new-strong-pw')),
    ).rejects.toThrow();
    expect(authWithPassword).not.toHaveBeenCalled();
  });

  it('rejects a password change when no one is authenticated', async () => {
    await expect(
      lastValueFrom(service.changePassword('old-pw', 'a-new-strong-pw')),
    ).rejects.toThrow(/not authenticated/i);
    expect(update).not.toHaveBeenCalled();
  });

  it('refreshes the auth token after auth state loads post-startup', async () => {
    const refreshIntervalMs = 1000 * 60 * 5;
    authRefresh.mockResolvedValue({});

    authStore.isValid = true;
    // A verified user only refreshes on the slow 5-minute loop (an unverified
    // one additionally polls fast — covered by its own tests below).
    authChangeHandler?.('token-123', {
      id: 'user-1',
      email: 'person@example.com',
      verified: true,
    });

    await vi.advanceTimersByTimeAsync(refreshIntervalMs);

    expect(authRefresh).toHaveBeenCalledTimes(1);
  });

  describe('unverified-email refresh polling', () => {
    const pollIntervalMs = 5_000;

    const signIn = (verified: boolean) => {
      authStore.isValid = true;
      authChangeHandler?.('token-123', {
        id: 'user-1',
        email: 'person@example.com',
        verified,
      });
      // Flush the toObservable effect so the poll (re)evaluates its condition.
      TestBed.tick();
    };

    it('polls a token refresh while the user is unverified and stops once verified', async () => {
      // The refreshed record reports verified — the SDK saves it into the
      // authStore, which is what flips needsEmailVerification in production.
      authRefresh.mockImplementation(async () => {
        authChangeHandler?.('token-123', {
          id: 'user-1',
          email: 'person@example.com',
          verified: true,
        });
        return {};
      });

      signIn(false);

      await vi.advanceTimersByTimeAsync(pollIntervalMs);
      expect(authRefresh).toHaveBeenCalledTimes(1);
      expect(service.user()?.['verified']).toBe(true);

      // Verified now — no further polling (the 5-minute loop is far away).
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(pollIntervalMs * 4);
      expect(authRefresh).toHaveBeenCalledTimes(1);
    });

    it('does not poll when the signed-in user is already verified', async () => {
      signIn(true);

      await vi.advanceTimersByTimeAsync(pollIntervalMs * 4);
      expect(authRefresh).not.toHaveBeenCalled();
    });

    it('keeps polling when a refresh attempt fails transiently', async () => {
      authRefresh.mockRejectedValueOnce(new Error('network down'));
      authRefresh.mockResolvedValue({});

      signIn(false);

      await vi.advanceTimersByTimeAsync(pollIntervalMs);
      expect(authRefresh).toHaveBeenCalledTimes(1);

      // The failed attempt must not kill the poll — the next tick retries.
      await vi.advanceTimersByTimeAsync(pollIntervalMs);
      expect(authRefresh).toHaveBeenCalledTimes(2);
      // And the transient failure is not surfaced as a user-facing error.
      expect(errorService.alert).not.toHaveBeenCalled();
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
    authWithPassword.mockResolvedValueOnce({ token: TEST_TOKEN });

    await expect(
      lastValueFrom(
        service.register('person@example.com', 'correct horse battery staple'),
      ),
    ).resolves.toEqual({ token: TEST_TOKEN });

    expect(create).toHaveBeenCalledWith({
      email: 'person@example.com',
      password: REGISTRATION_PASSWORD,
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

  describe('Google OAuth', () => {
    it('reports Google availability from PocketBase collection auth methods', async () => {
      await flushPromises();

      expect(listAuthMethods).toHaveBeenCalledTimes(1);
      expect(service.googleAvailable()).toBe(true);
    });

    it('signs in with Google and tracks login_completed without MFA', async () => {
      authWithOAuth2.mockResolvedValueOnce({
        token: 't',
        record: { id: 'user-1', email: 'person@example.com' },
      });

      const record = await lastValueFrom(service.loginWithGoogle());

      expect(authWithOAuth2).toHaveBeenCalledWith({ provider: 'google' });
      expect(record).toEqual({ id: 'user-1', email: 'person@example.com' });
      expect(service.oauthError()).toBeNull();
      expect(service.googleBusy()).toBe(false);
    });

    it('surfaces an accountExists error on ACCOUNT_EXISTS_USE_PASSWORD collision', async () => {
      authWithOAuth2.mockRejectedValueOnce({
        status: 401,
        response: { code: 'ACCOUNT_EXISTS_USE_PASSWORD' },
      });

      await expect(lastValueFrom(service.loginWithGoogle())).rejects.toBeTruthy();

      expect(service.oauthError()).toBe('accountExists');
      expect(service.googleBusy()).toBe(false);
    });

    it('surfaces a generic error for any other Google sign-in failure', async () => {
      authWithOAuth2.mockRejectedValueOnce(new Error('popup closed'));

      await expect(lastValueFrom(service.loginWithGoogle())).rejects.toBeTruthy();

      expect(service.oauthError()).toBe('generic');
    });

    it('loads the Cognos auth-methods view into state', async () => {
      cognosApiService.getAccountAuthMethods.mockReturnValue(
        of({ hasPassword: true, providers: ['google'] }),
      );

      await lastValueFrom(service.loadAuthMethods());

      expect(service.hasPassword()).toBe(true);
      expect(service.isGoogleLinked()).toBe(true);
    });

    it('defaults hasPassword to true before auth-methods have loaded', () => {
      expect(service.hasPassword()).toBe(true);
      expect(service.isGoogleLinked()).toBe(false);
    });

    it('links Google by confirming the password then completing the OAuth round trip', async () => {
      cognosApiService.createOAuthLinkIntent.mockReturnValue(
        of({ linkIntentId: 'intent-1' }),
      );
      cognosApiService.getAccountAuthMethods.mockReturnValue(
        of({ hasPassword: true, providers: ['google'] }),
      );
      authWithOAuth2.mockResolvedValueOnce({
        token: 't',
        record: { id: 'user-1' },
      });
      const popup = { closed: false, location: { href: '' } } as unknown as Window;

      await lastValueFrom(service.linkGoogle('correct-pw', popup));

      expect(cognosApiService.createOAuthLinkIntent).toHaveBeenCalledWith(
        'correct-pw',
        'google',
      );
      expect(authWithOAuth2).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          createData: { cognosLinkIntent: 'intent-1' },
        }),
      );
      // The urlCallback hands the pre-opened popup its destination, rather
      // than letting PocketBase open a fresh (Safari-blocked) window.
      const call = authWithOAuth2.mock.calls[0][0] as {
        urlCallback: (url: string) => void;
      };
      call.urlCallback('https://accounts.google.com/o/oauth2/auth');
      expect((popup as unknown as { location: { href: string } }).location.href).toBe(
        'https://accounts.google.com/o/oauth2/auth',
      );
      expect(service.isGoogleLinked()).toBe(true);
      expect(service.googleBusy()).toBe(false);
    });

    it('closes the popup and surfaces accountExists when linking collides with another account', async () => {
      cognosApiService.createOAuthLinkIntent.mockReturnValue(
        of({ linkIntentId: 'intent-1' }),
      );
      authWithOAuth2.mockRejectedValueOnce({
        status: 401,
        response: { code: 'ACCOUNT_EXISTS_USE_PASSWORD' },
      });
      const popup = { closed: false, close: vi.fn() } as unknown as Window;

      await expect(
        lastValueFrom(service.linkGoogle('correct-pw', popup)),
      ).rejects.toBeTruthy();

      expect(popup.close).toHaveBeenCalledTimes(1);
      expect(service.oauthError()).toBe('accountExists');
      expect(service.googleBusy()).toBe(false);
    });

    it('re-authenticates with Google to obtain a step-up id for account deletion', async () => {
      cognosApiService.beginOAuthStepUp.mockReturnValue(
        of({ challengeId: 'challenge-1' }),
      );
      cognosApiService.completeOAuthStepUp.mockReturnValue(
        of({ oauthStepUpId: 'stepup-1' }),
      );
      authWithOAuth2.mockResolvedValueOnce({ token: 't', record: { id: 'user-1' } });

      const oauthStepUpId = await lastValueFrom(service.stepUpWithGoogle(null));

      expect(cognosApiService.beginOAuthStepUp).toHaveBeenCalledTimes(1);
      expect(authWithOAuth2).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          createData: { cognosStepUpChallenge: 'challenge-1' },
        }),
      );
      expect(cognosApiService.completeOAuthStepUp).toHaveBeenCalledWith('challenge-1');
      expect(oauthStepUpId).toBe('stepup-1');
      expect(service.googleBusy()).toBe(false);
    });

    it('propagates a generic error when the step-up re-authentication fails', async () => {
      cognosApiService.beginOAuthStepUp.mockReturnValue(
        of({ challengeId: 'challenge-1' }),
      );
      authWithOAuth2.mockRejectedValueOnce(new Error('popup closed'));

      await expect(lastValueFrom(service.stepUpWithGoogle(null))).rejects.toBeTruthy();

      expect(cognosApiService.completeOAuthStepUp).not.toHaveBeenCalled();
      expect(service.oauthError()).toBe('generic');
      expect(service.googleBusy()).toBe(false);
    });
  });
});
