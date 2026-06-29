import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import PocketBase from 'pocketbase';

import { environment } from '../../environments/environment';
import { MfaService } from './mfa.service';

describe('MfaService', () => {
  let service: MfaService;
  let http: HttpTestingController;
  const base = environment.pocketbaseBaseUrl;

  const save = vi.fn();
  const authStore = { token: 'auth-token', save };

  const pocketbase = { authStore };

  beforeEach(() => {
    save.mockReset();
    authStore.token = 'auth-token';
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        MfaService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PocketBase, useValue: pocketbase },
      ],
    });

    service = TestBed.inject(MfaService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('fetches status with the bearer token', () => {
    let result: unknown;
    service.status().subscribe((r) => (result = r));

    const req = http.expectOne(`${base}/api/v1/mfa`);
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe('Bearer auth-token');
    req.flush({ enabled: true, pendingEnrolment: false, recoveryCodesRemaining: 7 });

    expect(result).toEqual({
      enabled: true,
      pendingEnrolment: false,
      recoveryCodesRemaining: 7,
    });
  });

  it('enrols with the current password', () => {
    service.enrol('my-password').subscribe();
    const req = http.expectOne(`${base}/api/v1/mfa/totp/enrol`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ password: 'my-password' });
    req.flush({ secret: 'ABC', otpauthUrl: 'otpauth://x' });
  });

  it('returns recovery codes from confirm', () => {
    let codes: string[] | undefined;
    service.confirm('123456').subscribe((c) => (codes = c));
    const req = http.expectOne(`${base}/api/v1/mfa/totp/confirm`);
    expect(req.request.body).toEqual({ code: '123456' });
    req.flush({ recoveryCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] });
    expect(codes).toEqual(['AAAAA-BBBBB', 'CCCCC-DDDDD']);
  });

  it('saves the issued token and remembers the device on TOTP completion', () => {
    service.completeTotp('sess-1', '123456', 'Person@Example.com', true).subscribe();

    const req = http.expectOne(`${base}/api/v1/auth/mfa/totp`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      mfaSessionId: 'sess-1',
      code: '123456',
      rememberDevice: true,
    });
    // Completion is unauthenticated — no bearer header required.
    expect(req.request.headers.get('Authorization')).toBeNull();

    req.flush({
      token: 'new-token',
      record: { id: 'u1' },
      meta: { trustedDeviceToken: 'device-xyz' },
    });

    expect(save).toHaveBeenCalledWith('new-token', { id: 'u1' });
    // Device token is stored under the lower-cased email.
    expect(service.deviceToken('person@example.com')).toBe('device-xyz');
  });

  it('does not store a device token when rememberDevice is false', () => {
    service.completeTotp('sess-1', '123456', 'person@example.com', false).subscribe();
    const req = http.expectOne(`${base}/api/v1/auth/mfa/totp`);
    req.flush({ token: 'new-token', record: { id: 'u1' } });

    expect(save).toHaveBeenCalledWith('new-token', { id: 'u1' });
    expect(service.deviceToken('person@example.com')).toBeNull();
  });

  it('completes with a recovery code via the recovery endpoint', () => {
    service
      .completeRecovery('sess-1', 'AAAAA-BBBBB', 'person@example.com', false)
      .subscribe();
    const req = http.expectOne(`${base}/api/v1/auth/mfa/recovery`);
    expect(req.request.body).toMatchObject({
      mfaSessionId: 'sess-1',
      code: 'AAAAA-BBBBB',
    });
    req.flush({ token: 'new-token', record: { id: 'u1' } });
    expect(save).toHaveBeenCalledWith('new-token', { id: 'u1' });
  });

  it('revokes a trusted device by id', () => {
    service.revokeTrustedDevice('dev-1').subscribe();
    const req = http.expectOne(`${base}/api/v1/mfa/trusted-devices/dev-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('stores and clears a device token under the lower-cased email', () => {
    expect(service.deviceToken('a@b.com')).toBeNull();
    // Store via a completion, then clear.
    service.completeTotp('s', 'c', 'A@B.com', true).subscribe();
    http.expectOne(`${base}/api/v1/auth/mfa/totp`).flush({
      token: 't',
      record: {},
      meta: { trustedDeviceToken: 'tok' },
    });
    expect(service.deviceToken('a@b.com')).toBe('tok');
    service.clearDeviceToken('a@b.com');
    expect(service.deviceToken('a@b.com')).toBeNull();
  });
});
