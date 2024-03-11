import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class VaultService {
  // sources

  // state

  // selectors
  secretKey = signal(new Uint8Array(32)); // TODO(ewan): replace with real secret key
}
