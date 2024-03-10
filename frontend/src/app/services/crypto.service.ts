import { Injectable } from '@angular/core';
import nacl from 'tweetnacl';

@Injectable({
  providedIn: 'root',
})
export class CryptoService {
  newKeyPair() {
    return nacl.box.keyPair();
  }
}
