---
description: Where property-based testing pays off in Cognos — existing coverage, candidate functions, and suggested properties
name: property-based-testing
---

# Property-Based Testing

Property-based testing (PBT) generates many random inputs and checks **invariants**
that must hold for all of them — roundtrips, monotonicity, idempotence, bounds,
security contracts. It complements table-driven example tests; it does not replace
integration or e2e coverage.

This document maps **where PBT already exists**, **where it should go next**, and
the **properties** worth asserting. Use it when adding `*_property_test.go` (Go)
or `fc.property` blocks (TypeScript).

## When to use PBT here

Reach for PBT when the code is:

- **Pure** — no I/O, no clocks, no database (or the clock is injected).
- **Contract-heavy** — billing precision, crypto roundtrips, auth replay windows,
  config key parsing, URL allowlists.
- **Combinatorial** — many dimensions interact (plan type × balance × estimate,
  model caps × reasoning budget × effort string).
- **Parser/serialiser** — encode/decode or normalise functions with a known shape.

Skip PBT when:

- Behaviour is mostly UI layout or DOM (use Playwright e2e).
- The function is a thin wrapper over an external SDK with no Cognos-specific logic.
- The input space is tiny and already exhaustively table-tested (e.g. a 5-value
  allowlist switch with no derived invariants).
- Tests would need heavy mocking — PBT shines on pure functions, not handler
  integration paths.

## Tooling and conventions

| Language   | Library                                                       | Declared in                                                 | Runner               |
| ---------- | ------------------------------------------------------------- | ----------------------------------------------------------- | -------------------- |
| Go         | [`pgregory.net/rapid`](https://pkg.go.dev/pgregory.net/rapid) | `backend/go.mod`                                            | `go test ./...`      |
| TypeScript | [`fast-check`](https://fast-check.dev/)                       | `frontend/package.json`, `packages/ui-angular/package.json` | `pnpm test` (Vitest) |

**Go conventions** (follow existing files):

- Separate file: `foo_property_test.go` next to `foo.go`.
- Top-of-test comment explaining **the contract being pinned** (see
  `totp_property_test.go`).
- Use `t.Parallel()` and `rapid.Check(t, func(t *rapid.T) { ... })`.
- Name generators with a suffix: `modelGen`, `usageGen`.
- Prefer `rapid.Int64Range`, `rapid.StringMatching`, `rapid.SliceOfN` over
  unconstrained `rapid.String()` when the domain is known.

**TypeScript conventions** (follow existing files):

- Keep PBT in the same `*.spec.ts` as example tests, or add `*.property.spec.ts`
  when the file would become unwieldy.
- Use `fc.assert(fc.property(...))` with **filtered arbitraries** when marker
  syntax could confuse round-trip oracles (see `citations.spec.ts`).
- Pin shrink-friendly bounds (`maxLength`, numeric ranges) so CI stays fast.

## Current coverage

### Go (`rapid`)

| File                                                                 | Functions under test                                                | Key properties                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `backend/internal/mfa/totp_property_test.go`                         | `Verify`                                                            | Accepted codes resolve to a step inside ±skew; out-of-window codes rejected |
| `backend/internal/mfa/seed_property_test.go`                         | `SeedCipher.Seal` / `Open`                                          | Round-trip seed encryption; wrong key/tamper rejection; stable `KeyID`      |
| `backend/internal/mfa/codes_property_test.go`                        | `NormalizeRecoveryCode`                                             | Idempotent normalisation; canonical alphabet preserved                      |
| `backend/internal/billing/microrappen_property_test.go`              | `FloorRappenFromMicro`, `CeilRappenFromMicro`, trial balance deltas | floor ≤ exact ≤ ceil; diff ≤ 1 rappen; display never overstates balance     |
| `backend/internal/billing/payg_property_test.go`                     | `ComputeCycleSummary`                                               | Clamp malformed inputs; expected bill is max(usage, commit)                 |
| `backend/internal/billing/access_property_test.go`                   | `EvaluateAccess`                                                    | Unlimited/inactive/trial gate consistency and rounded denial fields         |
| `backend/internal/billing/websearch_property_test.go`                | `Service.CalculateCost`                                             | Monotone in tokens/search; search fee additive; floor-positive              |
| `backend/internal/billing/ledger_property_test.go`                   | `BuildUsageRecord`                                                  | Unlimited zeroes amounts; metered plans negate precise cost; trial balance  |
| `backend/internal/billing/plan_type_property_test.go`                | `ParsePlanType`                                                     | Whitespace-trimmed valid values round-trip; unknowns rejected               |
| `backend/internal/billing/fx_rate_property_test.go`                  | `StaticFXRateProvider`                                              | Positive passthrough; invalid rates fall back; return always > 0            |
| `backend/internal/config/api_property_test.go`                       | `envKeyToConfigPath`                                                | COGNOS_ roundtrip; foreign keys ignored; at most one dot                    |
| `backend/internal/catalogue/requestysync/websearch_property_test.go` | `supportsWebSearchFor`                                              | Exactly `supports && geo == "eu"` (byte-exact)                              |
| `backend/internal/catalogue/requestysync/enrich_property_test.go`    | `NormalizeID`                                                       | Lowercase, trim, strip `@suffix`, suffix-insensitive                        |
| `backend/internal/catalogue/models_property_test.go`                 | `NormalizePrivacyTier`, `IsEligibleForTier`                         | Unknown defaults to EU; tier lattice matches access rules                   |
| `backend/internal/catalogue/display_name_property_test.go`           | `FriendlyModelName`                                                 | Idempotent; output never grows input                                        |
| `backend/internal/gateway/bifrost_websearch_test.go`                 | Stream citation boundary helpers                                    | UTF-8/rune-safe slicing; event reassembly invariants                        |
| `backend/internal/handler/complete_property_test.go`                 | `reasoningOutputPlan`                                               | max_tokens always stays above thinking budget; model cap respected          |
| `backend/internal/retention/retention_property_test.go`              | `EffectiveRetentionDays`, `Elapsed`                                 | Override order; boundary strictness; monotone in now                        |

### TypeScript (`fast-check`)

| File                                                    | Functions under test                                                    | Key properties                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| `packages/ui-angular/.../hover-intent-geometry.spec.ts` | `pointInTriangle`, `placePopover`, `hoverFunnel`                        | Geometry invariants, placement bounds                  |
| `frontend/src/app/utils/citations.spec.ts`              | `injectCitationMarkers`, `insertCitationMarkers`, `sanitizeCitationUrl` | Marker roundtrip; URL allowlist                        |
| `frontend/src/app/interfaces/message.spec.ts`           | `MessageData.safeParse`                                                 | Arbitrary garbage → clean success/failure, never throw |
| `frontend/src/app/services/message.service.spec.ts`     | Streaming frame reassembly                                              | Frame sequence invariants                              |

---

## Go — recommended candidates

Sorted by priority. **Existing test** = example/table tests already present.
**Suggested file** = new `*_property_test.go` unless noted.

### High priority

These guard money, security, or hard provider API contracts.

#### 1. `ComputeCycleSummary` — billing PAYG cycle math

|                    |                                                  |
| ------------------ | ------------------------------------------------ |
| **Source**         | `backend/internal/billing/payg.go`               |
| **Existing test**  | `backend/internal/billing/payg_test.go`          |
| **Suggested file** | `backend/internal/billing/payg_property_test.go` |

**Properties:**

- `expected == max(usage, commit)` and `overage == max(0, usage - commit)`.
- `expected >= commit` always (commit floor).
- `overage >= 0` always.
- Negative `usage` input clamps to zero local usage.

#### 2. `reasoningOutputPlan` — Anthropic thinking budget invariant

|                    |                                                             |
| ------------------ | ----------------------------------------------------------- |
| **Source**         | `backend/internal/handler/complete.go`                      |
| **Existing test**  | Partial (`compaction_internal_test.go` covers related caps) |
| **Suggested file** | `backend/internal/handler/complete_property_test.go`        |

**Properties:**

- When effort is `"off"`, `"none"`, or `""` → `reasoningBudget == 0`.
- **`maxOutput > reasoningBudget` always** (provider hard requirement).
- `maxOutput <= model.MaxOutputTokens` when the model cap is set.
- Unknown effort strings behave like `"medium"`.

#### 3. `SeedCipher.Seal` / `Open` — MFA seed encryption

|                    |                                                     |
| ------------------ | --------------------------------------------------- |
| **Source**         | `backend/internal/mfa/seed.go`                      |
| **Existing test**  | `backend/internal/mfa/seed_test.go` (single vector) |
| **Suggested file** | `backend/internal/mfa/seed_property_test.go`        |

**Properties:**

- `Open(Seal(seed)) == seed` for arbitrary byte payloads (0–4096 bytes).
- Wrong key always fails `Open`.
- Single flipped ciphertext byte fails authentication.
- `KeyID` stable for the same key material.

#### 4. `NormalizeRecoveryCode` — MFA recovery code canonicalisation

|                    |                                               |
| ------------------ | --------------------------------------------- |
| **Source**         | `backend/internal/mfa/codes.go`               |
| **Existing test**  | `backend/internal/mfa/codes_test.go`          |
| **Suggested file** | `backend/internal/mfa/codes_property_test.go` |

**Properties:**

- Idempotent: `Normalize(Normalize(s)) == Normalize(s)`.
- Output is uppercase alphanumeric only (no dashes/spaces).
- Characters outside `A-Z` / `2-9` are stripped.
- Roundtrip with `formatRecoveryCode` for valid alphabet draws.

#### 5. `CoveredMessageIDs` — compaction coverage set

|                    |                                                      |
| ------------------ | ---------------------------------------------------- |
| **Source**         | `backend/internal/compaction/build.go`               |
| **Existing test**  | `backend/internal/compaction/compaction_test.go`     |
| **Suggested file** | `backend/internal/compaction/build_property_test.go` |

**Properties:**

- No duplicates in output.
- Superset of both parent IDs and current message IDs.
- Parent IDs precede new-only IDs (stable ordering).
- Empty-string IDs filtered out.

#### 6. `Parse` (compaction) — citation alias resolution contract

|                    |                                                      |
| ------------------ | ---------------------------------------------------- |
| **Source**         | `backend/internal/compaction/parse.go`               |
| **Existing test**  | `backend/internal/compaction/compaction_test.go`     |
| **Suggested file** | `backend/internal/compaction/parse_property_test.go` |

**Properties:**

- Every citation `MessageID` in output comes from the supplied alias map (no invented IDs).
- Unknown aliases are dropped, not fatal.
- No duplicate citation labels.
- `DurableMemory.Items` never `nil` (empty slice normalisation).

#### 7. `BuildUsageRecord` — ledger row invariants

|                    |                                                    |
| ------------------ | -------------------------------------------------- |
| **Source**         | `backend/internal/billing/ledger.go`               |
| **Existing test**  | `backend/internal/billing/ledger_test.go`          |
| **Suggested file** | `backend/internal/billing/ledger_property_test.go` |

**Properties:**

- `PlanTypeUnlimited` → zero amounts always.
- Trial/PAYG → `AmountMicroRappen == -CostMicroRappen` exactly.
- Trial → `BalanceAfter == priorBalance - cost` exactly.
- Empty `OperationType` defaults to text.

#### 8. `EffectiveRetentionDays` / `Elapsed` — retention policy

|                    |                                                         |
| ------------------ | ------------------------------------------------------- |
| **Source**         | `backend/internal/retention/retention.go`               |
| **Existing test**  | `backend/internal/retention/retention_test.go`          |
| **Suggested file** | `backend/internal/retention/retention_property_test.go` |

**Properties for `EffectiveRetentionDays`:**

- `conversationDays > 0` wins over account default.
- `conversationDays < 0` → `0` (never-delete sentinel).
- Result always `>= 0`.

**Properties for `Elapsed`:**

- `days <= 0` or zero `lastActivity` → not elapsed.
- Strict boundary: elapsed iff `now.After(lastActivity + duration)`.
- Monotone in `now`.

#### 9. `NormalizeID` — catalogue model ID deduplication

|                    |                                                                   |
| ------------------ | ----------------------------------------------------------------- |
| **Source**         | `backend/internal/catalogue/requestysync/enrich.go`               |
| **Existing test**  | `backend/internal/catalogue/requestysync/enrich_test.go`          |
| **Suggested file** | `backend/internal/catalogue/requestysync/enrich_property_test.go` |

**Properties:**

- Idempotent and lowercase.
- Output never contains `@`.
- IDs differing only by `@suffix` normalise equal.

### Medium priority

#### 10. `EvaluateAccess` ↔ `CanAfford` — billing gate consistency

|                    |                                                    |
| ------------------ | -------------------------------------------------- |
| **Source**         | `backend/internal/billing/service.go`              |
| **Existing test**  | `backend/internal/billing/service_test.go`         |
| **Suggested file** | `backend/internal/billing/access_property_test.go` |

**Properties:**

- Unlimited → never restricted; inactive → always `INACTIVE`.
- Trial: restricted iff `balance < estimate`.
- When restricted, displayed balance uses floor and estimate uses ceil.

#### 11. `FriendlyModelName` — display name normalisation

|                    |                                                            |
| ------------------ | ---------------------------------------------------------- |
| **Source**         | `backend/internal/catalogue/display_name.go`               |
| **Existing test**  | `backend/internal/catalogue/display_name_test.go`          |
| **Suggested file** | `backend/internal/catalogue/display_name_property_test.go` |

**Properties:** idempotent; never empty; output length ≤ input length.

#### 12. `NormalizePrivacyTier` / `IsEligibleForTier` — privacy tier lattice

|                    |                                                      |
| ------------------ | ---------------------------------------------------- |
| **Source**         | `backend/internal/catalogue/models.go`               |
| **Existing test**  | None                                                 |
| **Suggested file** | `backend/internal/catalogue/models_property_test.go` |

**Properties:**

- Unknown tier strings → safe default (`eu`).
- Reflexive eligibility; `global` can access any tier; `ch_only` only `ch_only`.

#### 13. `ParsePlanType` — plan enum parsing

|                    |                                                       |
| ------------------ | ----------------------------------------------------- |
| **Source**         | `backend/internal/billing/plan_type.go`               |
| **Existing test**  | `backend/internal/billing/service_test.go`            |
| **Suggested file** | `backend/internal/billing/plan_type_property_test.go` |

**Properties:** round-trip for valid values; trim whitespace; reject unknown strings.

#### 14. `isResolvableHTTPURL` — grounding URL allowlist

|                    |                                                       |
| ------------------ | ----------------------------------------------------- |
| **Source**         | `backend/internal/gateway/grounding.go`               |
| **Existing test**  | Integration only (`grounding_test.go`)                |
| **Suggested file** | `backend/internal/gateway/grounding_property_test.go` |

**Properties:**

- `nil` and non-absolute → false.
- Only `http`/`https` with non-empty host → true.
- Arbitrary non-http schemes (`javascript:`, `data:`, …) → false.

#### 15. `StaticFXRateProvider` — FX fallback

|                    |                                                     |
| ------------------ | --------------------------------------------------- |
| **Source**         | `backend/internal/billing/fx_rate.go`               |
| **Existing test**  | `backend/internal/billing/fx_rate_test.go`          |
| **Suggested file** | `backend/internal/billing/fx_rate_property_test.go` |

**Properties:** positive rate passthrough; non-positive → fallback; return always `> 0`.

### Low priority (skip unless touching the code)

| Function                | Source                              | Why low                               |
| ----------------------- | ----------------------------------- | ------------------------------------- |
| `truncateReasonForLog`  | `handler/billing_refund_request.go` | Already well table-tested for UTF-8   |
| `completionStopKey`     | `handler/complete.go`               | Trivial string concat                 |
| `isValidExpiryDuration` | `handler/conversations.go`          | 5-value allowlist                     |
| `AliasMap`              | `compaction/build.go`               | Single loop; edge cases table-covered |

---

## TypeScript — recommended candidates

Sorted by priority. Frontend crypto lives in `frontend/src/app/crypto/` (worker-shared
primitives) and is mirrored in `e2e/tests/crypto-helpers.ts` for Playwright.

### High priority

#### 1. Crypto roundtrips — message and sealed-box encryption

|                    |                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| **Source**         | `frontend/src/app/crypto/secret-box.ts`, `sealed-box.ts`, `hash.ts`                                  |
| **E2E mirror**     | `e2e/tests/crypto-helpers.ts`                                                                        |
| **Existing test**  | `frontend/src/app/crypto/crypto-helpers.spec.ts`, `e2e/tests/crypto-helpers.spec.ts` (examples only) |
| **Suggested file** | Extend `crypto-helpers.spec.ts` with `fc.property` blocks                                            |

**Properties:**

- `openSecretBox(secretBox(msg, key), key) ≡ msg` for arbitrary `Uint8Array` payloads.
- Wrong key throws on open.
- `openSealedBox(createSealedBox(msg, pub), keyPair) ≡ msg`.
- `hashBytes` deterministic; 32-byte output; different inputs → different hashes.

#### 2. Redaction engine — overlap resolution and tokenisation

|                    |                                                                          |
| ------------------ | ------------------------------------------------------------------------ |
| **Source**         | `frontend/src/app/redaction/redaction-engine.ts`                         |
| **Existing test**  | Detector specs + `redaction-corpus.spec.ts`; **no dedicated engine PBT** |
| **Suggested file** | `frontend/src/app/redaction/redaction-engine.property.spec.ts`           |

**Properties:**

- `resolveOverlaps`: output sorted, non-overlapping, subset of input, idempotent.
- `applyRedactions`: redacted text contains no original candidate values when non-empty.
- `buildToken`: matches token regex; includes type code.
- `buildCustomCandidates`: every occurrence of search value appears exactly once.

#### 3. Document filename and href sanitisation

|                    |                                                 |
| ------------------ | ----------------------------------------------- |
| **Source**         | `frontend/src/app/documents/document-source.ts` |
| **Existing test**  | `document-source.spec.ts`                       |
| **Suggested file** | Add properties to existing spec                 |

**Properties:**

- `documentFilename`: correct extension; no forbidden chars; length cap; never empty.
- `sanitizeDocumentHref`: http(s) absolute URLs pass; other schemes null; idempotent on success
  path.

#### 4. `<cog-doc>` parser — total function over arbitrary strings

|                    |                                                        |
| ------------------ | ------------------------------------------------------ |
| **Source**         | `frontend/src/app/documents/cog-doc/cog-doc-parser.ts` |
| **Existing test**  | `cog-doc-parser.spec.ts`                               |
| **Suggested file** | Add properties to existing spec                        |

**Properties:**

- `segmentMessageContent` never throws for any string (including malformed/partial tags).
- No `<cog-doc` marker → empty or single markdown segment.
- `stripOuterNewline` idempotent.

#### 5. Model discovery normalisation

|                    |                                             |
| ------------------ | ------------------------------------------- |
| **Source**         | `frontend/src/app/utils/model-discovery.ts` |
| **Existing test**  | `model-discovery.spec.ts`                   |
| **Suggested file** | Add properties to existing spec             |

**Properties:**

- `normalizeSearchText`: idempotent, lowercase, trimmed, no consecutive spaces.
- `addRecentModel`: length ≤ cap; id at front; id appears once; stable relative order.
- `formatContextWindow`: monotone in token count within tier.

### Medium priority

#### 6. Sheet spec parsing and caps

|                   |                                                         |
| ----------------- | ------------------------------------------------------- |
| **Source**        | `frontend/src/app/documents/sheets/sheet-spec.types.ts` |
| **Existing test** | `sheet-spec.types.spec.ts`                              |

**Properties:** parse never throws; cap violations surface correct error codes; valid roundtrip
through JSON.

#### 7. Formula validator — column address arithmetic

|                   |                                                          |
| ----------------- | -------------------------------------------------------- |
| **Source**        | `frontend/src/app/documents/sheets/formula-validator.ts` |
| **Existing test** | `formula-validator.spec.ts`                              |

**Properties:** `columnIndex(columnLetters(n)) === n` roundtrip; blocked formulas become plain
values.

#### 8. User preferences serialisation

|                   |                                                   |
| ----------------- | ------------------------------------------------- |
| **Source**        | `frontend/src/app/interfaces/user_preferences.ts` |
| **Existing test** | `user_preferences.spec.ts`                        |

**Properties:** `parse(serialize(data)) ≡ data` for valid preference objects.

#### 9. Model cost tier derivation

|                   |                                             |
| ----------------- | ------------------------------------------- |
| **Source**        | `frontend/src/app/utils/model-cost-tier.ts` |
| **Existing test** | None dedicated                              |

**Properties:** non-negative blended cost; monotone pricing → monotone tier ordering.

#### 10. Redaction corpus scoring

|                   |                                                 |
| ----------------- | ----------------------------------------------- |
| **Source**        | `frontend/src/app/redaction/redaction-score.ts` |
| **Existing test** | `redaction-score.spec.ts` (minimal)             |

**Properties:** precision/recall in `[0, 1]`; boundary cases at zero TP/FP/FN.

#### 11. Analytics prop guard — privacy scrubbing

|                   |                                                     |
| ----------------- | --------------------------------------------------- |
| **Source**        | `frontend/src/app/services/analytics/prop-guard.ts` |
| **Existing test** | `prop-guard.spec.ts` (table-driven)                 |

**Properties:**

- Output keys always ⊆ catalogue for the event.
- No string value length > 32 survives.
- No value containing `@` survives.
- Production mode never throws (returns scrubbed props or `undefined`).

### Low priority

| Area                       | Source                                                             | Notes                                   |
| -------------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| Retention segment parsing  | `frontend/src/app/utils/retention.ts`                              | Roundtrip already example-tested        |
| Region tier resolution     | `frontend/src/app/utils/region.ts`                                 | Small enum; exhaustive examples suffice |
| Markdown → DocIR           | `frontend/src/app/documents/markdown/markdown-to-docir.ts`         | "Never throws" is the main win          |
| Minimap preview truncation | `frontend/src/app/components/chat/conversation-minimap/minimap.ts` | Unicode code-point length bound         |

---

## Suggested rollout order

A practical sequence if introducing PBT incrementally:

1. **Crypto roundtrips** (TS) — highest security leverage, libraries already in tree.
2. **`reasoningOutputPlan`** (Go) — prevents provider API rejections in production.
3. **`ComputeCycleSummary` + `BuildUsageRecord`** (Go) — money invariants adjacent to existing PBT.
4. **`NormalizeRecoveryCode` + `SeedCipher`** (Go) — MFA security path.
5. **`resolveOverlaps` / `applyRedactions`** (TS) — privacy engine core.
6. **`CoveredMessageIDs` + compaction `Parse`** (Go) — compaction correctness.
7. **`documentFilename` + cog-doc parser totality** (TS) — document pipeline safety.

Add one property test file per PR where possible; keep each file focused on a single
contract (matching existing `microrappen_property_test.go` style).

## Writing good property comments

Each property test should state **what production bug it prevents**, not just the
math. Examples from the codebase:

```go
// Property: the micro-rappen rounding pair never leaks money in the user's
// favour or ours beyond one rappen …
```

```go
// Property: for any secret and any verification time, Verify accepts a code
// generated for a step inside the ±verifySkew window … replay-protection contract
```

When a property can flake (e.g. 6-digit TOTP collision), document the escape hatch
explicitly — see `TestTOTPVerifyRejectsOutsideWindowProperty` in
`totp_property_test.go`.

## Related docs

- `docs/business_processes/usage-cost-calculation.md` — billing invariants PBT should mirror
- `docs/business_processes/mfa-recovery-codes.md` — recovery code normalisation contract
- `docs/business_processes/conversation-compaction.md` — compaction alias/citation rules
- `docs/specs/pii-redaction.md` — redaction engine behaviour
- `docs/security-model.md` — crypto and privacy claims PBT helps enforce
