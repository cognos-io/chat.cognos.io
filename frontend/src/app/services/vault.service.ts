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

interface VaultState {
  keyPair: KeyPair | undefined;
  keyPairRecord: UserKeyPairsResponse | null | undefined; // null means the record does not exist
  isNewKeyPair: boolean;
}

const initialState: VaultState = {
  keyPair: undefined,
  keyPairRecord: undefined,
  isNewKeyPair: false,
};

// Argon2id parameters as recommended by the OWASP password storage cheat sheet
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#introduction
const argon2idMemory = 19456; // 19MiB
const argon2idIterationCount = 2;
const argon2idParallelism = 1;
const passwordSaltBytes = 16;

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

  private readonly pbUserKeyPairsCollection = 'user_key_pairs';

  // sources
  readonly rawVaultPassword$ = new Subject<string>();

  readonly unlockError = signal<string | null>(null);

  // state
  private state = signalSlice({
    initialState,
    sources: [
      // Hash the vault password and fetch the key pair
      (state) =>
        this.rawVaultPassword$.pipe(
          switchMap((rawPassword) => {
            const keyPairRecord = state().keyPairRecord;
            if (keyPairRecord === null) {
              const passwordSalt = this.generatePasswordSalt();
              return this.hashVaultPassword(rawPassword, passwordSalt).pipe(
                switchMap((hashedVaultPassword) =>
                  this.createNewUserKeyPair(hashedVaultPassword, passwordSalt).pipe(
                    tap(() => this.clearUnlockError()),
                    map((keyPair) => ({ keyPair })),
                  ),
                ),
              );
            }
            if (keyPairRecord === undefined) {
              return EMPTY;
            }

            return this.unlockExistingUserKeyPair(rawPassword, keyPairRecord).pipe(
              tap(() => this.clearUnlockError()),
              map((keyPair) => ({ keyPair })),
              catchError(() => {
                this.unlockError.set(
                  'Error unlocking vault. Please check your vault password and try again. If this continues to fail try refreshing the page or trying again later.',
                );
                return EMPTY;
              }),
            );
          }),
        ),
      // Fetch the key pair record
      this.fetchUserKeyPairRecord().pipe(
        catchError((error) => {
          if (error.status === 404) {
            return of(null);
          }

          return throwError(() => error);
        }),
        map((keyPairRecord) => ({ keyPairRecord, isNewKeyPair: !keyPairRecord })),
      ),
      //   Clear the state when logging out
      this._authService.logout$.pipe(
        map(() => {
          return {
            keyPair: undefined,
          };
        }),
      ),
    ],
  });

  // selectors
  isNewKeyPair = this.state.isNewKeyPair;
  keyPair = this.state.keyPair;
  keyPair$ = toObservable(this.keyPair);

  hashVaultPassword(
    rawPassword: string,
    passwordSaltBase64: string,
  ): Observable<Uint8Array> {
    const encoder = new TextEncoder();
    const salt = Base64.toUint8Array(passwordSaltBase64);

    return from(getSetupWasmInstance()).pipe(
      map((argon2id) =>
        argon2id({
          password: encoder.encode(rawPassword),
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

  decryptSecretKey(
    encryptedSecretKey: Uint8Array,
    vaultPassword: Uint8Array,
  ): Uint8Array {
    return this._cryptoService.openSecretBox(encryptedSecretKey, vaultPassword);
  }

  encryptSecretKey(rawSecretKey: Uint8Array, vaultPassword: Uint8Array): Uint8Array {
    return this._cryptoService.secretBox(rawSecretKey, vaultPassword);
  }

  unpackKeyPairRecord(
    keyPairRecord: UserKeyPairsResponse,
    hashedVaultPassword: Uint8Array,
  ): KeyPair {
    const publicKey = Base64.toUint8Array(keyPairRecord.public_key);
    const encryptedSecretKey = Base64.toUint8Array(keyPairRecord.secret_key);
    const decryptedSecretKey = this.decryptSecretKey(
      encryptedSecretKey,
      hashedVaultPassword,
    );

    return {
      publicKey,
      secretKey: decryptedSecretKey,
    };
  }

  clearUnlockError() {
    this.unlockError.set(null);
  }

  createNewUserKeyPair(
    hashedVaultPassword: Uint8Array,
    passwordSalt: string,
  ): Observable<KeyPair> {
    const keyPair = this._cryptoService.newKeyPair();

    const encryptedSecretKey = this.encryptSecretKey(
      keyPair.secretKey,
      hashedVaultPassword,
    );

    const publicKeyBase64 = Base64.fromUint8Array(keyPair.publicKey);
    const encryptedSecretKeyBase64 = Base64.fromUint8Array(encryptedSecretKey);
    const keyPairRecordData: Partial<UserKeyPairsRecord> = {
      password_salt: passwordSalt,
      public_key: publicKeyBase64,
      secret_key: encryptedSecretKeyBase64,
      user: this._authService.user()?.['id'],
    };

    return from(
      this._pb.collection(this.pbUserKeyPairsCollection).create(keyPairRecordData),
    ).pipe(switchMap(() => of(keyPair)));
  }

  private unlockExistingUserKeyPair(
    rawPassword: string,
    keyPairRecord: UserKeyPairsResponse,
  ): Observable<KeyPair> {
    if (keyPairRecord.password_salt) {
      return this.hashVaultPassword(rawPassword, keyPairRecord.password_salt).pipe(
        map((hashedVaultPassword) =>
          this.unpackKeyPairRecord(keyPairRecord, hashedVaultPassword),
        ),
      );
    }

    return this.hashVaultPasswordWithLegacyEmailSalt(rawPassword).pipe(
      switchMap((hashedVaultPassword) => {
        const keyPair = this.unpackKeyPairRecord(keyPairRecord, hashedVaultPassword);
        return this.migrateLegacyUserKeyPairRecord(
          rawPassword,
          keyPairRecord,
          keyPair,
        ).pipe(map(() => keyPair));
      }),
    );
  }

  private hashVaultPasswordWithLegacyEmailSalt(
    rawPassword: string,
  ): Observable<Uint8Array> {
    const encoder = new TextEncoder();

    return from(getSetupWasmInstance()).pipe(
      map((argon2id) =>
        argon2id({
          password: encoder.encode(rawPassword),
          salt: encoder.encode(this._authService.email()),
          parallelism: argon2idParallelism,
          passes: argon2idIterationCount,
          memorySize: argon2idMemory,
          tagLength: nacl.secretbox.keyLength,
        }),
      ),
    );
  }

  private migrateLegacyUserKeyPairRecord(
    rawPassword: string,
    keyPairRecord: UserKeyPairsResponse,
    keyPair: KeyPair,
  ): Observable<unknown> {
    const passwordSalt = this.generatePasswordSalt();
    return this.hashVaultPassword(rawPassword, passwordSalt).pipe(
      switchMap((hashedVaultPassword) => {
        const encryptedSecretKey = this.encryptSecretKey(
          keyPair.secretKey,
          hashedVaultPassword,
        );
        return from(
          this._pb.collection(this.pbUserKeyPairsCollection).update(keyPairRecord.id, {
            password_salt: passwordSalt,
            secret_key: Base64.fromUint8Array(encryptedSecretKey),
          }),
        );
      }),
    );
  }

  private generatePasswordSalt(): string {
    return Base64.fromUint8Array(nacl.randomBytes(passwordSaltBytes));
  }
}
