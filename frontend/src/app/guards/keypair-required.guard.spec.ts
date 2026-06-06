import { firstValueFrom, Observable, Subject } from 'rxjs';

import { TestBed } from '@angular/core/testing';
import { Dialog } from '@angular/cdk/dialog';


import { keyPairRequiredGuard } from './keypair-required.guard';
import { VaultService } from '@app/services/vault.service';

describe('keyPairRequiredGuard', () => {
  let keyPair$: Subject<unknown>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let dialogRef: { closed: Subject<boolean>; close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    keyPair$ = new Subject<unknown>();
    dialogRef = {
      closed: new Subject<boolean>(),
      close: vi.fn(),
    };
    dialogOpen = vi.fn().mockReturnValue(dialogRef);

    TestBed.configureTestingModule({
      providers: [
        { provide: Dialog, useValue: { open: dialogOpen } },
        { provide: VaultService, useValue: { keyPair$ } },
      ],
    });
  });

  it('opens the vault password dialog until a key pair is available', async () => {
    const result$ = TestBed.runInInjectionContext(
      () => keyPairRequiredGuard({} as never, {} as never),
    ) as Observable<boolean>;
    const resultPromise = firstValueFrom(result$);

    keyPair$.next(null);
    expect(dialogOpen).toHaveBeenCalledTimes(1);

    keyPair$.next({ publicKey: new Uint8Array(), secretKey: new Uint8Array() });

    await expect(resultPromise).resolves.toBe(true);
    expect(dialogRef.close).toHaveBeenCalledTimes(1);
  });

  it('passes immediately when the key pair already exists', async () => {
    const result$ = TestBed.runInInjectionContext(
      () => keyPairRequiredGuard({} as never, {} as never),
    ) as Observable<boolean>;
    const resultPromise = firstValueFrom(result$);

    keyPair$.next({ publicKey: new Uint8Array(), secretKey: new Uint8Array() });

    await expect(resultPromise).resolves.toBe(true);
    expect(dialogOpen).not.toHaveBeenCalled();
  });
});
