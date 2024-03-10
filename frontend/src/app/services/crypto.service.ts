import { Injectable } from '@angular/core';
import nacl from 'tweetnacl';
import { KeyPair } from '../interfaces/key-pair';

@Injectable({
  providedIn: 'root',
})
export class CryptoService {
  newKeyPair(): KeyPair {
    return nacl.box.keyPair();
  }
}
