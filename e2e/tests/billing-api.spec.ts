import { expect, test } from '@playwright/test';

import { newAnonymousApi, provisionApiUser } from './api-helpers';

interface BillingResponse {
  plan_type: string;
  balance_chf: number;
}

interface BillingTransaction {
  id: string;
  occurred_at: string;
  type: string;
  amount_chf: number;
  balance_after_chf?: number;
  event_id?: string;
  model_id?: string;
  description?: string;
}

interface BillingTransactionsResponse {
  transactions: BillingTransaction[];
}

test.describe('billing status API', () => {
  test('unauthenticated callers cannot read billing state', async () => {
    const api = await newAnonymousApi();
    try {
      const res = await api.get('/api/v1/billing');
      expect(res.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('newly registered user lands on a recognised plan with a CHF balance', async () => {
    // PocketBase user-create hook auto-provisions a billing row for every
    // new user. The exact plan and balance are operator-configurable, but
    // the contract is: GET /billing must always return a known plan_type
    // (never empty/null) and a numeric balance_chf.
    const user = await provisionApiUser();
    try {
      const res = await user.api.get('/api/v1/billing');
      expect(res.ok(), `billing: ${res.status()} ${await res.text()}`).toBe(true);
      const body = (await res.json()) as BillingResponse;

      expect(['trial', 'payg', 'unlimited', 'inactive']).toContain(body.plan_type);
      expect(typeof body.balance_chf).toBe('number');
      expect(Number.isFinite(body.balance_chf)).toBe(true);
      // Balance must never be negative in the response — server-side
      // rounding could otherwise leak a stale debit state to the UI.
      expect(body.balance_chf).toBeGreaterThanOrEqual(0);
    } finally {
      await user.api.dispose();
    }
  });

  test('balance is reported in CHF, not Rappen', async () => {
    // The billing handler converts the integer Rappen ledger value into a
    // float CHF amount for the public contract. A regression that
    // forgot to divide by 100 would surface as a huge number — pin a
    // sane upper bound so we'd notice immediately.
    const user = await provisionApiUser();
    try {
      const res = await user.api.get('/api/v1/billing');
      const body = (await res.json()) as BillingResponse;

      // No reasonable seed/plan yields a four-digit CHF balance for a
      // brand-new user. If this fails, suspect a Rappen-as-CHF leak.
      expect(body.balance_chf).toBeLessThan(1000);
    } finally {
      await user.api.dispose();
    }
  });
});

test.describe('billing transactions API', () => {
  test('unauthenticated callers cannot read the ledger', async () => {
    const api = await newAnonymousApi();
    try {
      const res = await api.get('/api/v1/billing/transactions');
      expect(res.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('authenticated user receives a transactions array', async () => {
    const user = await provisionApiUser();
    try {
      const res = await user.api.get('/api/v1/billing/transactions');
      expect(res.ok(), `txns: ${res.status()} ${await res.text()}`).toBe(true);
      const body = (await res.json()) as BillingTransactionsResponse;

      expect(Array.isArray(body.transactions)).toBe(true);
      for (const txn of body.transactions) {
        expect(txn.id).toBeTruthy();
        expect(txn.occurred_at).toBeTruthy();
        expect(txn.type).toBeTruthy();
        expect(typeof txn.amount_chf).toBe('number');
      }
    } finally {
      await user.api.dispose();
    }
  });

  test("ledger is scoped to the calling user — never another user's rows", async () => {
    // The strongest privacy invariant on the billing API: a user must
    // only ever see their own ledger. Provision two users, fetch each
    // ledger, and check that no transaction id appears in both responses.
    const userA = await provisionApiUser();
    const userB = await provisionApiUser();
    try {
      const [resA, resB] = await Promise.all([
        userA.api.get('/api/v1/billing/transactions'),
        userB.api.get('/api/v1/billing/transactions'),
      ]);
      expect(resA.ok()).toBe(true);
      expect(resB.ok()).toBe(true);

      const bodyA = (await resA.json()) as BillingTransactionsResponse;
      const bodyB = (await resB.json()) as BillingTransactionsResponse;

      const idsA = new Set(bodyA.transactions.map((t) => t.id));
      for (const txn of bodyB.transactions) {
        expect(idsA.has(txn.id), `user B saw user A's txn id ${txn.id}`).toBe(false);
      }
    } finally {
      await userA.api.dispose();
      await userB.api.dispose();
    }
  });

  test('ledger amounts are reported in CHF and never expose Rappen', async () => {
    // Same Rappen-vs-CHF guard as the billing-state test but for the
    // ledger entries. The handler divides amount_rappen by 100 to produce
    // amount_chf; a regression would show as 4-digit amounts for any
    // realistic transaction.
    const user = await provisionApiUser();
    try {
      const res = await user.api.get('/api/v1/billing/transactions');
      const body = (await res.json()) as BillingTransactionsResponse;
      for (const txn of body.transactions) {
        expect(Math.abs(txn.amount_chf)).toBeLessThan(1000);
        if (typeof txn.balance_after_chf === 'number') {
          expect(txn.balance_after_chf).toBeLessThan(10_000);
        }
      }

      // The response must never carry the raw integer field name —
      // that's an internal accounting detail.
      const raw = await user.api.get('/api/v1/billing/transactions');
      const text = await raw.text();
      expect(text.includes('amount_rappen')).toBe(false);
      expect(text.includes('balance_after_rappen')).toBe(false);
    } finally {
      await user.api.dispose();
    }
  });
});
