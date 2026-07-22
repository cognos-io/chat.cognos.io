# Property-based testing

Property tests explore broad input spaces for small, deterministic invariants. Use them where a few
examples cannot cover the meaningful combinations; keep browser and API e2e tests for product
journeys and authorisation boundaries.

## Tools

- Go: [`rapid`](https://github.com/flyingmutant/rapid), in `*_property_test.go`
- TypeScript: [`fast-check`](https://fast-check.dev/), inside the owning `*.spec.ts`

Run them through the normal suites:

```sh
just go-test
pnpm --filter @cognos/chat test
pnpm --filter @cognos/ui-angular test
```

## Current coverage

Go properties cover:

- billing access, plans, PAYG, Organisation Seats, exact micro-rappen arithmetic, FX and web search
- Model catalogue and Requesty enrichment
- MFA codes, TOTP windows and seed encryption
- Conversation retention, Completion budgeting and configuration mapping
- Compaction delimited-JSON parse (round-trip + garbage fails closed)

TypeScript properties cover:

- import parsing and ZIP boundaries
- Message schemas, citations and selected Message-service transformations
- adoption state and Organisation billing restrictions
- shared hover-intent geometry
- crypto secret-box / sealed-box round trips (`frontend/src/app/crypto/crypto-helpers.spec.ts`)
- Redaction apply/hydrate round trips (`frontend/src/app/redaction/redaction-hydration.spec.ts`)

Search for `rapid.Check` and `fc.assert` for the executable inventory. Do not maintain a second
line-by-line wish list here.

## Write a useful property

1. State one invariant in a comment above the test.
2. Generate only valid domain states unless invalid input is the property under test.
3. Assert the externally meaningful rule, not the implementation steps.
4. Keep generators small enough to shrink quickly and print the seed on failure.
5. Add table-driven examples for named edge cases that a reader should recognise immediately.

Good candidates include round trips, monotonicity, idempotency, ordering, bounds, lossless
normalisation and “never grants access” rules. Avoid property tests for orchestration, UI
appearance, network retries or behaviour already clearer as three examples.

## Security rules

- Never generate or print real secrets, prompts, Message content or customer data.
- A failing case is test data, but still keep it synthetic and content-free.
- Cross-Account access denial remains an API integration test; a pure property cannot prove route,
  middleware and database-rule composition.

Related invariants live in [usage cost calculation](./business_processes/usage-cost-calculation.md),
[MFA recovery codes](./business_processes/mfa-recovery-codes.md),
[Conversation compaction](./business_processes/conversation-compaction.md),
[Redaction](./business_processes/pii-redaction.md) and the [security model](./security-model.md).
