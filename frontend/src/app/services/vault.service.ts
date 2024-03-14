import { Injectable, inject, signal } from '@angular/core';
import { signalSlice } from 'ngxtension/signal-slice';
import loadArgon2idWasm from 'argon2id';
import { AuthService } from './auth.service';
import { Observable, from, map } from 'rxjs';

interface VaultState {}

const initialState: VaultState = {};

// Argon2id parameters as recommended by the Owasp password storage cheat sheet
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#introduction
const argon2idMemory = 19456; // 19MiB
const argon2idIterationCount = 2;
const argon2idParallelism = 1;

@Injectable({
  providedIn: 'root',
})
export class VaultService {
  private readonly authService = inject(AuthService);

  // sources
  readonly rawVaultPassword$ = signal('');

  // state
  private state = signalSlice({
    initialState,
    sources: [],
  });

  // selectors
  secretKey = signal(new Uint8Array(32)); // TODO(ewan): replace with real secret key

  hashVaultPassword(rawPassword: string): Observable<Uint8Array> {
    const encoder = new TextEncoder();

    return from(loadArgon2idWasm()).pipe(
      map((argon2id) =>
        argon2id({
          password: encoder.encode(rawPassword),
          salt: encoder.encode(this.authService.oryId()),
          parallelism: argon2idParallelism,
          passes: argon2idIterationCount,
          memorySize: argon2idMemory,
          tagLength: 256, // output a 256-bit hash to use as a key
        })
      )
    );
  }
}
