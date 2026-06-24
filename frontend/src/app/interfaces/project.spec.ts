import { TestBed } from '@angular/core/testing';

import { CryptoService } from '@app/services/crypto.service';

import { ProjectData, parseProjectData, serializeProjectData } from './project';

// These tests pin the project encryption model from docs/specs/projects.md:
//   data = secretBox(serialize(metadata), projectContentKey)
//   wrapped_project_key = sealedBox(projectContentKey, userPublicKey)
// They guarantee round-trips succeed and that the wrong key fails closed.
describe('project crypto round-trip', () => {
  let crypto: CryptoService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    crypto = TestBed.inject(CryptoService);
  });

  const sampleData: ProjectData = {
    version: '1',
    name: 'Acme launch',
    description: 'Private project notes',
    icon: 'users',
    color: 'blue',
    instructions: '',
    defaultModelId: 'claude-sonnet-4-6',
  };

  it('defaults defaultModelId to empty for older project blobs', () => {
    // Projects created before the field existed must still parse (encrypted
    // under the project content key, the value never appears in plaintext).
    const legacy = new TextEncoder().encode(
      JSON.stringify({ version: '1', name: 'Old', icon: 'users', color: 'blue' }),
    );
    expect(parseProjectData(legacy).defaultModelId).toBe('');
  });

  // tweetnacl rejects byte arrays from another realm (vitest/jsdom gives
  // TextEncoder its own Uint8Array constructor), so normalise serialized
  // metadata into this realm's Uint8Array before encrypting — mirrors the
  // CryptoService spec's `bytes()` helper.
  const serialized = (data: ProjectData) => Uint8Array.from(serializeProjectData(data));

  it('serializes and parses project metadata losslessly', () => {
    const parsed = parseProjectData(serializeProjectData(sampleData));
    expect(parsed).toEqual(sampleData);
  });

  it('encrypts and decrypts project metadata under the content key', () => {
    const contentKey = crypto.randomKey();
    const ciphertext = crypto.secretBox(serialized(sampleData), contentKey);

    // Ciphertext must not leak the plaintext name.
    const asText = new TextDecoder().decode(ciphertext);
    expect(asText).not.toContain('Acme launch');

    const decrypted = parseProjectData(crypto.openSecretBox(ciphertext, contentKey));
    expect(decrypted).toEqual(sampleData);
  });

  it('wraps the content key to a user public key and unwraps it', () => {
    const userKeyPair = crypto.newKeyPair();
    const contentKey = crypto.randomKey();

    const wrapped = crypto.createSealedBox(contentKey, userKeyPair.publicKey);
    const unwrapped = crypto.openSealedBox(wrapped, userKeyPair);

    expect(unwrapped).toEqual(contentKey);

    // The unwrapped key must decrypt data sealed under the original key.
    const ciphertext = crypto.secretBox(serialized(sampleData), contentKey);
    expect(parseProjectData(crypto.openSecretBox(ciphertext, unwrapped))).toEqual(
      sampleData,
    );
  });

  it('fails closed when the content key is wrong', () => {
    const ciphertext = crypto.secretBox(serialized(sampleData), crypto.randomKey());
    expect(() => crypto.openSecretBox(ciphertext, crypto.randomKey())).toThrow();
  });

  it('fails closed when a different user key tries to unwrap', () => {
    const owner = crypto.newKeyPair();
    const attacker = crypto.newKeyPair();
    const contentKey = crypto.randomKey();

    const wrapped = crypto.createSealedBox(contentKey, owner.publicKey);
    expect(() => crypto.openSealedBox(wrapped, attacker)).toThrow();
  });
});
