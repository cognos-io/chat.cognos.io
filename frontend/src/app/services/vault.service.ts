import { Injectable, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import PocketBase from 'pocketbase';

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

import {
  TypedPocketBase,
  UserKeyPairsRecord,
  UserKeyPairsResponse,
} from '@app/types/pocketbase-types';

import { KeyPair } from '@interfaces/key-pair';

import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';
import { TrustedUnlockService } from './trusted-unlock.service';

interface VaultState {
  keyPair: KeyPair | undefined;
  keyPairRecord: UserKeyPairsResponse | null | undefined; // null means the record does not exist
  isNewKeyPair: boolean;
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
};

const unlockSchemePasswordAccountKey = 'password_account_key_v1';

// Argon2id parameters as recommended by the OWASP password storage cheat sheet
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#introduction
const argon2idMemory = 19456; // 19MiB
const argon2idIterationCount = 2;
const argon2idParallelism = 1;
const passwordSaltBytes = 16;
const accountKeyBytes = 16;

let setupWasmInstance: ReturnType<typeof setupWasm> | undefined;

const getSetupWasmInstance = () => {
  setupWasmInstance ??= setupWasm(
    (importObject) =>
      WebAssembly.instantiateStreaming(
        fetch('/assets/wasm/argon2id/simd.wasm'),
        importObject,
      ),
    (importObject) =>
      WebAssembly.instantiateStreaming(
        fetch('/assets/wasm/argon2id/no-simd.wasm'),
        importObject,
      ),
  );

  return setupWasmInstance;
};

@Injectable({
  providedIn: 'root',
})
export class VaultService {
  private readonly _pb: TypedPocketBase = inject(PocketBase);
  private readonly _cryptoService = inject(CryptoService);
  private readonly _authService = inject(AuthService);
  private readonly _trustedUnlockService = inject(TrustedUnlockService);

  private readonly pbUserKeyPairsCollection = 'user_key_pairs';

  readonly generatedAccountKey = signal<string | null>(null);
  readonly wasLocked = signal(false);

  // sources
  readonly unlockRequest$ = new Subject<UnlockRequest>();
  readonly lock$ = new Subject<void>();

  readonly unlockError = signal<string | null>(null);

  // state
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
                map(({ keyPair, keyPairRecord }) => ({
                  keyPair,
                  keyPairRecord,
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
            })),
          ),
        ),
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
  keyPair$ = toObservable(this.keyPair);

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
    const filter = this._pb.filter('user={:user}', {
      user: this._authService.user()?.['id'],
    });

    return from(
      this._pb.collection(this.pbUserKeyPairsCollection).getFirstListItem(filter),
    );
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
    const keyPairRecordData: Partial<UserKeyPairsRecord> = {
      password_salt: passwordSalt,
      public_key: publicKeyBase64,
      secret_key: encryptedSecretKeyBase64,
      unlock_scheme: unlockSchemePasswordAccountKey,
      user: this._authService.user()?.['id'],
    };

    return from(
      this._pb.collection(this.pbUserKeyPairsCollection).create(keyPairRecordData),
    ).pipe(
      switchMap((keyPairRecord) =>
        from(this.persistTrustedUnlockKey(unlockKey, trustDevice)).pipe(
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
      const keyPair = this.unpackKeyPairRecord(keyPairRecord, storedUnlockKey);
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
}
