import { Dialog } from '@angular/cdk/dialog';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KeyPair } from '@app/interfaces/key-pair';
import { VaultService } from '@app/services/vault.service';

import { VaultUnlockGateDirective } from './vault-unlock-gate.directive';

@Component({
  selector: 'app-vault-gate-host',
  standalone: true,
  template: '',
  hostDirectives: [VaultUnlockGateDirective],
})
class HostComponent {}

describe('VaultUnlockGateDirective', () => {
  let keyPair: ReturnType<typeof signal<KeyPair | undefined>>;
  let isRestoring: ReturnType<typeof signal<boolean>>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let dialogClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    keyPair = signal<KeyPair | undefined>(undefined);
    isRestoring = signal(false);
    dialogClose = vi.fn();
    dialogOpen = vi.fn().mockReturnValue({ close: dialogClose });

    TestBed.configureTestingModule({
      providers: [
        { provide: Dialog, useValue: { open: dialogOpen } },
        {
          provide: VaultService,
          useValue: { keyPair, isRestoring, notifyUnlockPrompted: vi.fn() },
        },
      ],
    });
  });

  it('opens the unlock dialog when the vault is locked', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    expect(dialogOpen).toHaveBeenCalledTimes(1);
  });

  it('waits out the trusted-session restore before prompting', () => {
    isRestoring.set(true);

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    expect(dialogOpen).not.toHaveBeenCalled();
  });

  it('closes the prompt once the vault unlocks', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(dialogOpen).toHaveBeenCalledTimes(1);

    keyPair.set({ publicKey: new Uint8Array(), secretKey: new Uint8Array() });
    fixture.detectChanges();

    expect(dialogClose).toHaveBeenCalledTimes(1);
  });
});
