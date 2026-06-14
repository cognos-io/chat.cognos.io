import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  from,
  map,
  of,
  switchMap,
  tap,
  throwError,
} from 'rxjs';

import setupWasm from 'argon2id/lib/setup';
import { Base64 } from 'js-base64';
import { signalSlice } from 'ngxtension/signal-slice';
import nacl from 'tweetnacl';

import { UserKeyPairsRecord, UserKeyPairsResponse } from '@app/types/pocketbase-types';

import { KeyPair } from '@interfaces/key-pair';

import { AuthService } from './auth.service';
import { CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { TrustedUnlockService } from './trusted-unlock.service';

interface VaultState {
  keyPair: KeyPair | undefined;
  keyPairRecord: UserKeyPairsResponse | null | undefined;
  isNewKeyPair: boolean;
  isRestoring: boolean;
}

interface UnlockRequest {
  accountKey: string;
  accountPassword: string;
  trustDevice: boolean;
}

const initialState: VaultState = {
  keyPair: undefined,
  keyPairRecord: undefined,
  isNewKeyPair: false,
  isRestoring: true,
};

const unlockSchemePasswordAccountKey = 'password_account_key_v1';

const argon2idMemory = 65536; // 64MiB
const argon2idIterationCount = 3;
const argon2idParallelism = 1;
const passwordSaltBytes = 16;
const accountKeyBytes = 16;
const simdWasmSHA384 =
  'lq17elS4aq0P0DV4bzHHzZGjjkz7/DwuX9RRNjhsw3xCqN8G5oyXjlcacOxhXZxJ';
const noSimdWasmSHA384 =
  'CXsNdctBSGlR8eWNDhWAekxve6pGotK6LroWxyQSwEQK9iILS/gE/sKBe+Z9kJdY';
const userKeyPairRecordMACContext = 'user_key_pair_record_v1';
const trustedUserKeyContextPrefix = 'cognos:trusted-user-key:';

let setupWasmInstance: ReturnType<typeof setupWasm> | undefined;

async function instantiateVerifiedWasm(
  url: string,
  expectedSHA384: string,
  importObject: WebAssembly.Imports,
) {
  const response = await fetch(url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-384', bytes);
  const digestBase64 = Base64.fromUint8Array(new Uint8Array(digest));

  if (digestBase64 !== expectedSHA384) {
    throw new Error(`WASM digest mismatch for ${url}`);
  }

  return WebAssembly.instantiate(bytes, importObject);
}

const getSetupWasmInstance = () => {
  setupWasmInstance ??= setupWasm(
    (importObject) =>
      instantiateVerifiedWasm(
        '/assets/wasm/argon2id/simd.wasm',
        simdWasmSHA384,
        importObject,
      ),
    (importObject) =>
      instantiateVerifiedWasm(
        '/assets/wasm/argon2id/no-simd.wasm',
        noSimdWasmSHA384,
        importObject,
      ),
  );

  return setupWasmInstance;
};

@Injectable({
  providedIn: 'root',
})
export class VaultService {
  private readonly _api = inject(CognosApiService);
  private readonly _cryptoService = inject(CryptoService);
  private readonly _authService = inject(AuthService);
  private readonly _trustedUnlockService = inject(TrustedUnlockService);

  readonly generatedAccountKey = signal<string | null>(null);
  readonly wasLocked = signal(false);
  readonly unlockRequest$ = new Subject<UnlockRequest>();
  readonly lock$ = new Subject<void>();
  readonly unlockError = signal<string | null>(null);

  private state = signalSlice({
    initialState,
    sources: [
      (state) =>
        this.unlockRequest$.pipe(
          switchMap((request) => {
            const keyPairRecord = state().keyPairRecord;
            if (keyPairRecord === null) {
              return this.createInitialUserKeyPair(request).pipe(
                tap(() => {
                  this.wasLocked.set(false);
                  this.clearUnlockError();
                }),
                map(({ keyPair, keyPairRecord: createdKeyPairRecord }) => ({
                  keyPair,
                  keyPairRecord: createdKeyPairRecord,
                  isNewKeyPair: false,
                })),
                catchError(() => {
                  this.unlockError.set(
                    'Error creating your encrypted backup. Please try again.',
                  );
                  return EMPTY;
                }),
              );
            }
            if (keyPairRecord === undefined) {
              return EMPTY;
            }

            return this.unlockExistingUserKeyPair(request, keyPairRecord).pipe(
              tap(() => {
                this.wasLocked.set(false);
                this.clearUnlockError();
              }),
              map((keyPair) => ({ keyPair })),
              catchError(() => {
                this.unlockError.set(
                  'Error unlocking your encrypted backup. Please check your details and try again.',
                );
                return EMPTY;
              }),
            );
          }),
        ),
      this.fetchUserKeyPairRecord().pipe(
        catchError((error) => {
          if (error.status === 404) {
            this.ensureGeneratedAccountKey();
            return of(null);
          }

          return throwError(() => error);
        }),
        switchMap((keyPairRecord) =>
          from(this.buildFetchedVaultState(keyPairRecord)).pipe(
            map((nextState) => ({
              keyPair: nextState.keyPair,
              keyPairRecord,
              isNewKeyPair: !keyPairRecord,
              isRestoring: false,
            })),
          ),
        ),
        catchError(() => of({ isRestoring: false })),
      ),
      this.lock$.pipe(
        switchMap(() =>
          from(this._trustedUnlockService.clearAllUnlockKeys()).pipe(
            map(() => {
              this.wasLocked.set(true);
              this.clearUnlockError();
              return {
                keyPair: undefined,
              };
            }),
          ),
        ),
      ),
      this._authService.logout$.pipe(
        switchMap(() =>
          from(this._trustedUnlockService.clearAllUnlockKeys()).pipe(
            map(() => {
              this.generatedAccountKey.set(null);
              this.wasLocked.set(false);
              this.clearUnlockError();
              return {
                keyPair: undefined,
              };
            }),
          ),
        ),
      ),
    ],
  });

  isNewKeyPair = this.state.isNewKeyPair;
  keyPair = this.state.keyPair;
  isRestoring = this.state.isRestoring;
  keyPair$ = toObservable(this.keyPair);

  /**
   * Canonical fingerprint of the unlocked public key — base64(blake2b(publicKey)).
   * This is the exact value persisted in the trusted-device context, so anything
   * displaying a fingerprint should derive from here rather than re-hashing.
   */
  publicKeyFingerprint = computed(() => {
    const keyPair = this.keyPair();

    return keyPair ? this.computePublicKeyFingerprint(keyPair.publicKey) : '';
  });

  hashSecretMaterial(
    secretMaterial: Uint8Array,
    passwordSaltBase64: string,
  ): Observable<Uint8Array> {
    const salt = Base64.toUint8Array(passwordSaltBase64);

    return from(getSetupWasmInstance()).pipe(
      map((argon2id) =>
        argon2id({
          password: secretMaterial,
          salt,
          parallelism: argon2idParallelism,
          passes: argon2idIterationCount,
          memorySize: argon2idMemory,
          tagLength: nacl.secretbox.keyLength,
        }),
      ),
    );
  }

  fetchUserKeyPairRecord(): Observable<UserKeyPairsResponse> {
    return this._api.getUserKeyPair();
  }

  decryptSecretKey(encryptedSecretKey: Uint8Array, unlockKey: Uint8Array): Uint8Array {
    return this._cryptoService.openSecretBox(encryptedSecretKey, unlockKey);
  }

  encryptSecretKey(rawSecretKey: Uint8Array, unlockKey: Uint8Array): Uint8Array {
    return this._cryptoService.secretBox(rawSecretKey, unlockKey);
  }

  unpackKeyPairRecord(
    keyPairRecord: UserKeyPairsResponse,
    unlockKey: Uint8Array,
  ): KeyPair {
    if (!keyPairRecord.record_mac) {
      throw new Error('User key pair integrity metadata missing');
    }

    const actualMAC = this.computeUserKeyPairRecordMAC(keyPairRecord, unlockKey);
    const expectedMAC = Base64.toUint8Array(keyPairRecord.record_mac);

    if (!this._cryptoService.equalBytes(actualMAC, expectedMAC)) {
      throw new Error('User key pair integrity check failed');
    }

    const publicKey = Base64.toUint8Array(keyPairRecord.public_key);
    const encryptedSecretKey = Base64.toUint8Array(keyPairRecord.secret_key);
    const decryptedSecretKey = this.decryptSecretKey(encryptedSecretKey, unlockKey);

    return {
      publicKey,
      secretKey: decryptedSecretKey,
    };
  }

  clearUnlockError() {
    this.unlockError.set(null);
  }

  lock() {
    this.lock$.next();
  }

  private buildPasswordAccountKeySecretMaterial(
    rawPassword: string,
    accountKey: string,
  ): Uint8Array {
    return new TextEncoder().encode(
      `${rawPassword}\u0000${this.normaliseAccountKey(accountKey)}`,
    );
  }

  private createInitialUserKeyPair(request: UnlockRequest): Observable<{
    keyPair: KeyPair;
    keyPairRecord: UserKeyPairsResponse;
  }> {
    const accountKey = this.generatedAccountKey();
    if (!accountKey) {
      return throwError(() => new Error('missing generated account key'));
    }

    const passwordSalt = this.generatePasswordSalt();
    const secretMaterial = this.buildPasswordAccountKeySecretMaterial(
      request.accountPassword,
      accountKey,
    );

    return this.hashSecretMaterial(secretMaterial, passwordSalt).pipe(
      switchMap((unlockKey) =>
        this.createNewUserKeyPair(unlockKey, passwordSalt, request.trustDevice),
      ),
      tap(() => this.generatedAccountKey.set(null)),
    );
  }

  private createNewUserKeyPair(
    unlockKey: Uint8Array,
    passwordSalt: string,
    trustDevice: boolean,
  ): Observable<{
    keyPair: KeyPair;
    keyPairRecord: UserKeyPairsResponse;
  }> {
    const keyPair = this._cryptoService.newKeyPair();

    const encryptedSecretKey = this.encryptSecretKey(keyPair.secretKey, unlockKey);
    const publicKeyBase64 = Base64.fromUint8Array(keyPair.publicKey);
    const encryptedSecretKeyBase64 = Base64.fromUint8Array(encryptedSecretKey);
    const userID = this._authService.user()?.['id'];
    const keyPairRecordData = {
      password_salt: passwordSalt,
      public_key: publicKeyBase64,
      record_mac: Base64.fromUint8Array(
        this.computeUserKeyPairRecordMAC(
          {
            password_salt: passwordSalt,
            public_key: publicKeyBase64,
            secret_key: encryptedSecretKeyBase64,
            unlock_scheme: unlockSchemePasswordAccountKey,
            user: userID ?? '',
          },
          unlockKey,
        ),
      ),
      secret_key: encryptedSecretKeyBase64,
      unlock_scheme: unlockSchemePasswordAccountKey,
    };

    return this._api.createUserKeyPair(keyPairRecordData).pipe(
      switchMap((keyPairRecord) =>
        from(this.persistTrustedUnlockKey(unlockKey, trustDevice)).pipe(
          tap(() => this.persistTrustedUserKeyContext(keyPairRecord)),
          map(() => ({ keyPair, keyPairRecord })),
        ),
      ),
    );
  }

  private unlockExistingUserKeyPair(
    request: UnlockRequest,
    keyPairRecord: UserKeyPairsResponse,
  ): Observable<KeyPair> {
    if (
      keyPairRecord.unlock_scheme !== unlockSchemePasswordAccountKey ||
      !keyPairRecord.password_salt
    ) {
      return throwError(() => new Error('invalid encrypted backup metadata'));
    }

    this.assertTrustedUserKeyContext(keyPairRecord);

    const secretMaterial = this.buildPasswordAccountKeySecretMaterial(
      request.accountPassword,
      request.accountKey,
    );
    return this.hashSecretMaterial(secretMaterial, keyPairRecord.password_salt).pipe(
      map((unlockKey) => ({
        keyPair: this.unpackKeyPairRecord(keyPairRecord, unlockKey),
        unlockKey,
      })),
      switchMap(({ keyPair, unlockKey }) =>
        from(this.persistTrustedUnlockKey(unlockKey, request.trustDevice)).pipe(
          tap(() => this.persistTrustedUserKeyContext(keyPairRecord)),
          map(() => keyPair),
        ),
      ),
    );
  }

  private async buildFetchedVaultState(
    keyPairRecord: UserKeyPairsResponse | null,
  ): Promise<{ keyPair?: KeyPair }> {
    if (keyPairRecord === null) {
      this.ensureGeneratedAccountKey();
      return {};
    }

    this.generatedAccountKey.set(null);

    const storedUnlockKey = await this._trustedUnlockService.getUnlockKey(
      this._authService.user()?.['id'],
    );
    if (!storedUnlockKey) {
      return {};
    }

    try {
      this.assertTrustedUserKeyContext(keyPairRecord);
      const keyPair = this.unpackKeyPairRecord(keyPairRecord, storedUnlockKey);
      this.persistTrustedUserKeyContext(keyPairRecord);
      return { keyPair };
    } catch {
      await this._trustedUnlockService.clearUnlockKey(this._authService.user()?.['id']);
      return {};
    }
  }

  private async persistTrustedUnlockKey(
    unlockKey: Uint8Array,
    trustDevice: boolean,
  ): Promise<void> {
    if (!trustDevice) {
      await this._trustedUnlockService.clearUnlockKey(this._authService.user()?.['id']);
      return;
    }

    try {
      await this._trustedUnlockService.setUnlockKey(
        this._authService.user()?.['id'],
        unlockKey,
      );
    } catch {
      await this._trustedUnlockService.clearUnlockKey(this._authService.user()?.['id']);
    }
  }

  private ensureGeneratedAccountKey(): void {
    if (this.generatedAccountKey()) {
      return;
    }

    this.generatedAccountKey.set(this.generateAccountKey());
  }

  private generatePasswordSalt(): string {
    return Base64.fromUint8Array(nacl.randomBytes(passwordSaltBytes));
  }

  private generateAccountKey(): string {
    const accountKey = Array.from(nacl.randomBytes(accountKeyBytes), (value) =>
      value.toString(16).padStart(2, '0').toUpperCase(),
    ).join('');

    return accountKey.match(/.{1,4}/g)?.join('-') ?? accountKey;
  }

  private normaliseAccountKey(accountKey: string): string {
    return accountKey.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  }

  private computeUserKeyPairRecordMAC(
    keyPairRecord: Pick<
      UserKeyPairsRecord,
      'password_salt' | 'public_key' | 'secret_key' | 'unlock_scheme' | 'user'
    >,
    unlockKey: Uint8Array,
  ): Uint8Array {
    const payload = new TextEncoder().encode(
      JSON.stringify([
        userKeyPairRecordMACContext,
        keyPairRecord.user,
        keyPairRecord.unlock_scheme ?? '',
        keyPairRecord.password_salt ?? '',
        keyPairRecord.public_key,
        keyPairRecord.secret_key,
      ]),
    );

    return this._cryptoService.mac(payload, unlockKey);
  }

  private trustedUserKeyContextStorageKey(userID: string): string {
    return `${trustedUserKeyContextPrefix}${userID}`;
  }

  private assertTrustedUserKeyContext(keyPairRecord: UserKeyPairsResponse): void {
    const userID = this._authService.user()?.['id'];
    if (!userID) {
      return;
    }

    const rawContext = localStorage.getItem(
      this.trustedUserKeyContextStorageKey(userID),
    );
    if (!rawContext) {
      return;
    }

    const context = JSON.parse(rawContext) as {
      passwordSalt?: string;
      publicKeyFingerprint?: string;
      unlockScheme?: string;
    };

    if (
      context.unlockScheme &&
      context.unlockScheme !== (keyPairRecord.unlock_scheme ?? '')
    ) {
      throw new Error('Trusted user key scheme changed');
    }

    if (
      context.passwordSalt &&
      context.passwordSalt !== (keyPairRecord.password_salt ?? '')
    ) {
      throw new Error('Trusted user key salt changed');
    }

    const publicKeyFingerprint = this.computePublicKeyFingerprint(
      Base64.toUint8Array(keyPairRecord.public_key),
    );
    if (
      context.publicKeyFingerprint &&
      context.publicKeyFingerprint !== publicKeyFingerprint
    ) {
      throw new Error('Trusted user public key changed');
    }
  }

  private computePublicKeyFingerprint(publicKey: Uint8Array): string {
    return Base64.fromUint8Array(this._cryptoService.hash(publicKey));
  }

  private persistTrustedUserKeyContext(keyPairRecord: UserKeyPairsResponse): void {
    const userID = this._authService.user()?.['id'];
    if (!userID) {
      return;
    }

    localStorage.setItem(
      this.trustedUserKeyContextStorageKey(userID),
      JSON.stringify({
        passwordSalt: keyPairRecord.password_salt ?? '',
        publicKeyFingerprint: this.computePublicKeyFingerprint(
          Base64.toUint8Array(keyPairRecord.public_key),
        ),
        unlockScheme: keyPairRecord.unlock_scheme ?? '',
      }),
    );
  }
}
