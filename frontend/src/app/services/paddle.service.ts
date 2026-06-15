import { Injectable, InjectionToken, inject } from '@angular/core';

import { Subject } from 'rxjs';

import { CheckoutEventNames, type Paddle, initializePaddle } from '@paddle/paddle-js';

import { environment } from '../../environments/environment';

// PaddleConfig is the client-side Paddle.js configuration. It's behind an
// injection token (rather than read from `environment` directly) so tests can
// override it — the Angular unit-test harness can't mock relative imports.
export interface PaddleConfig {
  token: string;
  environment: 'sandbox' | 'production';
}

export const PADDLE_CONFIG = new InjectionToken<PaddleConfig>('PADDLE_CONFIG', {
  providedIn: 'root',
  factory: () => ({
    token: environment.paddleClientToken,
    environment: environment.paddleEnvironment,
  }),
});

// PaddleService owns the Paddle.js lifecycle: it lazily loads and initialises
// the SDK on first use, opens the hosted checkout *overlay* for a server-created
// transaction, and surfaces checkout completion so the billing flow can refresh.
// When no client token is configured the service is disabled — callers fall
// back to the hosted-checkout redirect.
@Injectable({ providedIn: 'root' })
export class PaddleService {
  private readonly _config = inject(PADDLE_CONFIG);
  private readonly _token = this._config.token;
  private readonly _environment = this._config.environment;

  private _paddlePromise: Promise<Paddle | undefined> | null = null;

  // Emits once a checkout completes so the billing state can be refreshed /
  // polled. The overlay closes itself; we only need the completion signal.
  readonly checkoutCompleted$ = new Subject<void>();

  // enabled is false without a client token, so the caller knows to use the
  // hosted-checkout fallback instead of the overlay.
  get enabled(): boolean {
    return this._token.trim().length > 0;
  }

  // openCheckout opens the Paddle overlay for a server-created transaction.
  // Returns false when Paddle is unavailable so the caller can fall back.
  async openCheckout(transactionId: string): Promise<boolean> {
    const paddle = await this._init();
    if (!paddle) {
      return false;
    }
    paddle.Checkout.open({ transactionId });
    return true;
  }

  // _init loads + initialises Paddle.js once, wiring the completion event. The
  // promise is cached so concurrent callers share a single initialisation.
  private _init(): Promise<Paddle | undefined> {
    if (!this.enabled) {
      return Promise.resolve(undefined);
    }
    this._paddlePromise ??= initializePaddle({
      environment: this._environment,
      token: this._token,
      eventCallback: (event) => {
        if (event.name === CheckoutEventNames.CHECKOUT_COMPLETED) {
          this.checkoutCompleted$.next();
        }
      },
    });
    return this._paddlePromise;
  }
}
