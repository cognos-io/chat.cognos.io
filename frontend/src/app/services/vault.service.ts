import { Injectable, inject } from '@angular/core';
import { signalSlice } from 'ngxtension/signal-slice';
import setupWasm from 'argon2id/lib/setup';
import { AuthService } from './auth.service';
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
  throwError,
} from 'rxjs';
import { KeyPair } from '../interfaces/key-pair';
import { TypedPocketBase, UserKeyPairsRecord } from '../types/pocketbase-types';
import { CryptoService } from './crypto.service';
import nacl from 'tweetnacl';
import { Base64 } from 'js-base64';

interface VaultState {
  keyPair: KeyPair | undefined;
  keyPairRecord: UserKeyPairsRecord | null | undefined; // null means the record does not exist
}

const initialState: VaultState = {
  keyPair: undefined,
  keyPairRecord: undefined,
};

// Argon2id parameters as recommended by the OWASP password storage cheat sheet
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#introduction
const argon2idMemory = 19456; // 19MiB
const argon2idIterationCount = 2;
const argon2idParallelism = 1;

const setupWasmInstance = setupWasm(
  (importObject) =>
    WebAssembly.instantiateStreaming(
      fetch('/assets/wasm/argon2id/simd.wasm'),
      importObject
    ),
  (importObject) =>
    WebAssembly.instantiateStreaming(
      fetch('/assets/wasm/argon2id/no-simd.wasm'),
      importObject
    )
);

@Injectable({
  providedIn: 'root',
})
export class VaultService {
  private readonly pb: TypedPocketBase = inject(PocketBase);
  private readonly cryptoService = inject(CryptoService);
  private readonly authService = inject(AuthService);

  private readonly pbUserKeyPairsCollection = 'user_key_pairs';

  // sources
  readonly rawVaultPassword$ = new Subject<string>();

  // state
  private state = signalSlice({
    initialState,
    sources: [
      // Hash the vault password and fetch the key pair
      (state) =>
        this.rawVaultPassword$.pipe(
          switchMap((rawPassword) =>
            this.hashVaultPassword(rawPassword).pipe(
              switchMap((hashedVaultPassword) => {
                const keyPairRecord = state().keyPairRecord;
                if (keyPairRecord === null) {
                  return this.createNewUserKeyPair(hashedVaultPassword).pipe(
                    map((keyPair) => ({ keyPair }))
                  );
                }
                if (!keyPairRecord) {
                  return EMPTY;
                }
                try {
                  const keyPair = this.unpackKeyPairRecord(
                    keyPairRecord,
                    hashedVaultPassword
                  );
                  return of({ keyPair });
                } catch (error) {
                  console.error('Error unpacking key pair record', error);
                  return EMPTY;
                }
              })
            )
          )
        ),
      // Fetch the key pair record
      this.fetchUserKeyPairRecord().pipe(
        catchError((error) => {
          if (error.status === 404) {
            return of(null);
          }

          return throwError(() => error);
        }),
        map((keyPairRecord) => ({ keyPairRecord }))
      ),
    ],
  });

  // selectors
  keyPair = this.state.keyPair;

  hashVaultPassword(rawPassword: string): Observable<Uint8Array> {
    const encoder = new TextEncoder();

    return from(setupWasmInstance).pipe(
      map((argon2id) =>
        argon2id({
          password: encoder.encode(rawPassword),
          salt: encoder.encode(this.authService.oryId()),
          parallelism: argon2idParallelism,
          passes: argon2idIterationCount,
          memorySize: argon2idMemory,
          tagLength: nacl.secretbox.keyLength, // output a a hash of the same length as a secret key
        })
      )
    );
  }

  fetchUserKeyPairRecord(): Observable<UserKeyPairsRecord> {
    const filter = this.pb.filter('user={:user}', {
      user: this.authService.user()?.['id'],
    });

    return from(
      this.pb.collection(this.pbUserKeyPairsCollection).getFirstListItem(filter)
    );
  }

  decryptSecretKey(
    encryptedSecretKey: Uint8Array,
    vaultPassword: Uint8Array
  ): Uint8Array {
    return this.cryptoService.openSecretBox(encryptedSecretKey, vaultPassword);
  }

  encryptSecretKey(
    rawSecretKey: Uint8Array,
    vaultPassword: Uint8Array
  ): Uint8Array {
    return this.cryptoService.secretBox(rawSecretKey, vaultPassword);
  }

  unpackKeyPairRecord(
    keyPairRecord: UserKeyPairsRecord,
    hashedVaultPassword: Uint8Array
  ): KeyPair {
    const publicKey = Base64.toUint8Array(keyPairRecord.public_key);
    const encryptedSecretKey = Base64.toUint8Array(keyPairRecord.secret_key);
    const decryptedSecretKey = this.decryptSecretKey(
      encryptedSecretKey,
      hashedVaultPassword
    );

    return {
      publicKey,
      secretKey: decryptedSecretKey,
    };
  }

  createNewUserKeyPair(hashedVaultPassword: Uint8Array): Observable<KeyPair> {
    const keyPair = this.cryptoService.newKeyPair();

    const encryptedSecretKey = this.encryptSecretKey(
      keyPair.secretKey,
      hashedVaultPassword
    );

    const publicKeyBase64 = Base64.fromUint8Array(keyPair.publicKey);
    const encryptedSecretKeyBase64 = Base64.fromUint8Array(encryptedSecretKey);
    const keyPairRecordData: Partial<UserKeyPairsRecord> = {
      public_key: publicKeyBase64,
      secret_key: encryptedSecretKeyBase64,
      user: this.authService.user()?.['id'],
    };

    return from(
      this.pb
        .collection(this.pbUserKeyPairsCollection)
        .create(keyPairRecordData)
    ).pipe(switchMap(() => of(keyPair)));
  }
}
