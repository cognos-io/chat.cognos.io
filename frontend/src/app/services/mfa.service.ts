import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import PocketBase, { AuthModel } from 'pocketbase';

import { Observable, map, tap } from 'rxjs';

import { environment } from '../../environments/environment';
import { TypedPocketBase } from '../types/pocketbase-types';

export interface MfaStatus {
  enabled: boolean;
  enrolledAt?: string;
  pendingEnrolment: boolean;
  recoveryCodesRemaining: number;
}

export interface MfaEnrolment {
  /** base32 secret for manual entry into an authenticator app. */
  secret: string;
  /** otpauth:// provisioning URI for the QR code. */
  otpauthUrl: string;
}

export interface TrustedDevice {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt: string;
}

interface CompletionResponse {
  token: string;
  record: AuthModel;
  meta?: { trustedDeviceToken?: string; trustedDeviceTtlDays?: number };
}

/**
 * MfaService owns every call to the first-party MFA API plus the per-device
 * "remember this device" token. The completion calls are unauthenticated (the
 * caller holds an mfaSessionId, not a token yet) and, on success, save the
 * issued token into PocketBase's authStore — which drives the rest of the
 * login/vault flow exactly as a normal sign-in would.
 */
@Injectable({ providedIn: 'root' })
export class MfaService {
  private readonly _http = inject(HttpClient);
  private readonly _pb: TypedPocketBase = inject(PocketBase);
  private readonly _baseUrl = environment.pocketbaseBaseUrl;

  /** localStorage key prefix for the trusted-device token, scoped by email. */
  private static readonly DEVICE_KEY_PREFIX = 'cognos:mfa-device:';

  // --- management (authenticated) ------------------------------------------

  status(): Observable<MfaStatus> {
    return this._http.get<MfaStatus>(`${this._baseUrl}/api/v1/mfa`, {
      headers: this.authHeaders(),
    });
  }

  enrol(password: string): Observable<MfaEnrolment> {
    return this._http.post<MfaEnrolment>(
      `${this._baseUrl}/api/v1/mfa/totp/enrol`,
      { password },
      { headers: this.authHeaders() },
    );
  }

  /** Confirm the first code; returns the one-time recovery codes. */
  confirm(code: string): Observable<string[]> {
    return this._http
      .post<{
        recoveryCodes: string[];
      }>(
        `${this._baseUrl}/api/v1/mfa/totp/confirm`,
        { code },
        { headers: this.authHeaders() },
      )
      .pipe(map((r) => r.recoveryCodes));
  }

  disable(password: string, code: string): Observable<void> {
    return this._http
      .post(
        `${this._baseUrl}/api/v1/mfa/totp/disable`,
        { password, code },
        { headers: this.authHeaders() },
      )
      .pipe(map(() => undefined));
  }

  regenerateRecoveryCodes(code: string): Observable<string[]> {
    return this._http
      .post<{
        recoveryCodes: string[];
      }>(
        `${this._baseUrl}/api/v1/mfa/recovery-codes`,
        { code },
        { headers: this.authHeaders() },
      )
      .pipe(map((r) => r.recoveryCodes));
  }

  listTrustedDevices(): Observable<TrustedDevice[]> {
    return this._http
      .get<{ devices: TrustedDevice[] }>(
        `${this._baseUrl}/api/v1/mfa/trusted-devices`,
        {
          headers: this.authHeaders(),
        },
      )
      .pipe(map((r) => r.devices ?? []));
  }

  revokeTrustedDevice(id: string): Observable<void> {
    return this._http
      .delete(`${this._baseUrl}/api/v1/mfa/trusted-devices/${id}`, {
        headers: this.authHeaders(),
      })
      .pipe(map(() => undefined));
  }

  // --- login completion (unauthenticated) ----------------------------------

  /** Complete a login with a TOTP code; saves the issued token on success. */
  completeTotp(
    mfaSessionId: string,
    code: string,
    email: string,
    rememberDevice: boolean,
  ): Observable<AuthModel> {
    return this.complete(
      '/api/v1/auth/mfa/totp',
      mfaSessionId,
      code,
      email,
      rememberDevice,
    );
  }

  /** Complete a login with a recovery code; saves the issued token on success. */
  completeRecovery(
    mfaSessionId: string,
    code: string,
    email: string,
    rememberDevice: boolean,
  ): Observable<AuthModel> {
    return this.complete(
      '/api/v1/auth/mfa/recovery',
      mfaSessionId,
      code,
      email,
      rememberDevice,
    );
  }

  // --- trusted-device token storage ----------------------------------------

  /** The stored trusted-device token for an email, if any. */
  deviceToken(email: string): string | null {
    try {
      return localStorage.getItem(MfaService.DEVICE_KEY_PREFIX + email.toLowerCase());
    } catch {
      return null;
    }
  }

  /** Forget a device token (e.g. when it stops being accepted). */
  clearDeviceToken(email: string): void {
    try {
      localStorage.removeItem(MfaService.DEVICE_KEY_PREFIX + email.toLowerCase());
    } catch {
      /* storage unavailable; nothing to clear */
    }
  }

  private storeDeviceToken(email: string, token: string): void {
    try {
      localStorage.setItem(MfaService.DEVICE_KEY_PREFIX + email.toLowerCase(), token);
    } catch {
      /* storage unavailable; user will be challenged next time */
    }
  }

  private complete(
    path: string,
    mfaSessionId: string,
    code: string,
    email: string,
    rememberDevice: boolean,
  ): Observable<AuthModel> {
    const deviceLabel = this.defaultDeviceLabel();
    return this._http
      .post<CompletionResponse>(`${this._baseUrl}${path}`, {
        mfaSessionId,
        code,
        rememberDevice,
        deviceLabel,
      })
      .pipe(
        tap((res) => {
          // Drive the rest of the app exactly like a normal sign-in.
          this._pb.authStore.save(res.token, res.record);
          const deviceToken = res.meta?.trustedDeviceToken;
          if (rememberDevice && deviceToken) {
            this.storeDeviceToken(email, deviceToken);
          }
        }),
        map((res) => res.record),
      );
  }

  private defaultDeviceLabel(): string {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS device';
    if (/Android/i.test(ua)) return 'Android device';
    if (/Macintosh/i.test(ua)) return 'Mac';
    if (/Windows/i.test(ua)) return 'Windows PC';
    if (/Linux/i.test(ua)) return 'Linux device';
    return 'This device';
  }

  private authHeaders(): HttpHeaders {
    const token = this._pb.authStore.token;
    return token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
  }
}
