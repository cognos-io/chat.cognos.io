import { TestBed } from '@angular/core/testing';

import { initializePaddle } from '@paddle/paddle-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PADDLE_CONFIG, PaddleService } from './paddle.service';

// The SDK (a node_modules package) is mocked so no script loads; the
// eventCallback is captured so we can simulate completion. The client token is
// supplied via PADDLE_CONFIG, which the harness lets us override.
vi.mock('@paddle/paddle-js', () => ({
  initializePaddle: vi.fn(),
  CheckoutEventNames: { CHECKOUT_COMPLETED: 'checkout.completed' },
}));

describe('PaddleService', () => {
  const open = vi.fn();
  let capturedEventCallback: ((event: { name: string }) => void) | undefined;

  beforeEach(() => {
    open.mockReset();
    capturedEventCallback = undefined;
    vi.mocked(initializePaddle).mockReset();
    vi.mocked(initializePaddle).mockImplementation((options) => {
      capturedEventCallback = options?.eventCallback as typeof capturedEventCallback;
      return Promise.resolve({ Checkout: { open } } as never);
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        PaddleService,
        {
          provide: PADDLE_CONFIG,
          useValue: { token: 'test_token', environment: 'sandbox' },
        },
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
    capturedEventCallback?.({ name: 'checkout.completed' });

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
