import { TestBed } from '@angular/core/testing';

import { CheckoutEventNames } from '@paddle/paddle-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PADDLE_CONFIG, PADDLE_INITIALIZE, PaddleService } from './paddle.service';

// The Paddle loader is injected (PADDLE_INITIALIZE) and stubbed here, so no
// script ever loads and there is no node_modules ESM mock to hoist. The
// eventCallback is captured to simulate completion; the client token comes from
// PADDLE_CONFIG, which the harness lets us override.
describe('PaddleService', () => {
  const open = vi.fn();
  let capturedEventCallback: ((event: { name: string }) => void) | undefined;
  const initializePaddle = vi.fn();

  beforeEach(() => {
    open.mockReset();
    capturedEventCallback = undefined;
    initializePaddle.mockReset();
    initializePaddle.mockImplementation((options) => {
      capturedEventCallback = options?.eventCallback as typeof capturedEventCallback;
      return Promise.resolve({ Checkout: { open } });
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        PaddleService,
        {
          provide: PADDLE_CONFIG,
          useValue: { token: 'test_token', environment: 'sandbox' },
        },
        { provide: PADDLE_INITIALIZE, useValue: initializePaddle },
      ],
    });
  });

  // Sunny: a configured token enables the overlay.
  it('is enabled when a client token is configured', () => {
    const service = TestBed.inject(PaddleService);
    expect(service.enabled).toBe(true);
  });

  // Sunny: opens the overlay for the given transaction and initialises once.
  it('opens the overlay for a transaction id', async () => {
    const service = TestBed.inject(PaddleService);

    const opened = await service.openCheckout('txn_42');

    expect(opened).toBe(true);
    expect(initializePaddle).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith({ transactionId: 'txn_42' });
  });

  // Sunny: a second checkout reuses the same Paddle instance (no re-init).
  it('initialises Paddle only once across calls', async () => {
    const service = TestBed.inject(PaddleService);

    await service.openCheckout('txn_1');
    await service.openCheckout('txn_2');

    expect(initializePaddle).toHaveBeenCalledOnce();
  });

  // Sunny: the completion event is forwarded to subscribers.
  it('emits checkoutCompleted$ on the completion event', async () => {
    const service = TestBed.inject(PaddleService);
    const seen = vi.fn();
    service.checkoutCompleted$.subscribe(seen);

    await service.openCheckout('txn_1');
    capturedEventCallback?.({ name: CheckoutEventNames.CHECKOUT_COMPLETED });

    expect(seen).toHaveBeenCalledOnce();
  });

  // Edge: an unrelated event does not trigger completion.
  it('ignores non-completion events', async () => {
    const service = TestBed.inject(PaddleService);
    const seen = vi.fn();
    service.checkoutCompleted$.subscribe(seen);

    await service.openCheckout('txn_1');
    capturedEventCallback?.({ name: 'checkout.loaded' });

    expect(seen).not.toHaveBeenCalled();
  });
});
