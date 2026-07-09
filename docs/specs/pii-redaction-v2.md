# Browser PII Redaction v2 — detection depth, severity, and measurement

Follow-up to `docs/specs/pii-redaction.md` (the v1 spec, shipped Phases 1–4). v1 delivered a
precision-first, always-on Tier 1 structured engine with encrypted per-conversation/project/user
mappings, composer preview, and hydration. This spec covers the four deferred/weak areas that keep
the feature from reading as a first-class trust differentiator:

1. **Severity + informed-consent UX** — turn the silent, uniform preview into a graded signal with a
   first-run explainer and a category-gated confirm for high-severity data
   (health/financial/secret).
2. **Detection depth** — new structured detectors, context-aware weak-signal promotion, a health
   category, and a user-scoped allowlist ("never redact this").
3. **Tier 2 NLP in a Web Worker** — wire the deferred `compromise` layer for names/orgs/places,
   off the main thread, so recall improves without freezing the composer.
4. **Measurement** — a labelled fixture corpus scored for precision/recall per detector, CI gates so
   a new detector cannot silently regress precision, and privacy-safe local counters.

This spec does **not** re-open key management, storage, public sharing, or the token format — those
are settled in v1 and unchanged here. New detectors and NLP hints flow through the existing
`Detector` interface, token model, `redaction_entries` storage, and hydration pipeline untouched.

## 0. Build status

### Shipped in this branch

- Settings now expose four modes: **Off**, **Simple (fast)**, **Better (slower)**, and disabled
  **Comprehensive (sends data to Cognos servers)**.
- `simple` keeps the fast v1 detector set. `better` adds local-only context, structured, and health
  detectors.
- Composer preview groups detected values by severity (`critical`, `high`, `medium`, `low`).
- If a user opts out of redacting a detected value, the send warning includes the highest severity.
- New detectors cover DOB context, passport, Swiss driving licence, PostFinance/account context,
  Swiss health-insurance numbers, and health-keyword hints.
- Better mode now runs the local `compromise` person/org/place layer in a Web Worker, with
  synchronous structured detection as the fallback path.
- Users can add a detected value to a sealed user-scoped "never redact this" list and remove it
  again from `/account/memory`.
- Corpus scoring exists at `frontend/src/app/redaction/corpus/baseline-v2.json` with a CI-style
  threshold test in `redaction-corpus.spec.ts`.
- Browser e2e asserts typed prompt values reach the provider only as placeholders.
- API e2e asserts stored message rows expose neither raw values nor redaction placeholders.

### Still open

- First-run explainer modal.
- Chunked/incremental detection.
- Privacy-safe local counters.
- Real server-side comprehensive mode. The UI option is intentionally disabled.

## 1. Overview

v1's engine is correct but quiet. It detects high-precision structured values on the main thread,
selects Tier 1 by default, and shows a flat "N will be redacted" list where an IP address and an AWS
key look identical. There is no first-run moment, no health detection, no NLP, no way to stop a
recurring false positive, and no accuracy metric to tell whether a detector change helped.

v2 keeps the pure/source-agnostic engine and adds four layers around it:

- a **severity** dimension on every candidate, derived from its type, that drives copy, ordering,
  and whether a confirm is warranted;
- **more and smarter detectors** (structured additions + a context-aware middle tier + health);
- an **opt-in Tier 2 NLP worker** that returns advisory `person`/`org`/`place` hints;
- a **measurement harness** (corpus + CI gates + privacy-safe counters) so detection quality is a
  number, not a vibe.

## 2. Goals

- Make the _reason_ for a redaction legible: users learn, once, what was hidden and why, and
  high-severity categories get an explicit "we found health/financial data" moment.
- Materially improve recall on names/addresses/prose (Tier 2) and on weak structured signals
  (phones without `+`, dates of birth, passport/licence numbers) without hurting Tier 1 precision.
- Never block or jank the composer: NLP and large-paste detection run off the main thread.
- Give the team a precision/recall number per detector, gated in CI, before expanding coverage.
- Preserve v1's guarantees exactly: no raw values to backend/provider/logs/analytics; mappings
  encrypted under the separate redaction key; tokens unchanged.

## 3. Non-goals

- Server-side detection or any change to what the backend can read. Everything new stays on-device.
- A heavy ML NER model (GLiNER/WebGPU/transformers.js). Tier 2 stays `compromise`-class; the worker
  boundary is designed so a heavier backend _could_ drop in later, but that is out of scope here.
- OCR of pasted images / scanned PDFs. Detection over image bytes is noted as a downstream item
  (§13) but not built.
- Telemetry that transmits any content. Counters are counts only and stay client-side / aggregate.
- Changing the token format, storage schema, key model, or public-share behaviour.

## 4. Severity model

### 4.1 The severity dimension

Add a `severity` classification derived from `RedactionType`. Severity is **not** the same as
`RedactionConfidence` (which is about _how sure the detector is_); severity is about _how damaging
the value is if it leaks_. A low-confidence NLP name hint and a high-confidence email are both
`medium`/`low` severity; a high-confidence AWS key is `critical`.

Proposed tiers:

| Severity   | Types                                                                               | Rationale                                                      |
| ---------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `critical` | `secret`                                                                            | Live credentials — immediate, automatable compromise.          |
| `high`     | `credit_card`, `iban`, all national/tax IDs, health (`§7`)                          | Financial loss / special-category data (GDPR Art. 9).          |
| `medium`   | `phone`, `us_ssn` contact-adjacent, `ip_address`, `person` (Tier 2), `org`, `place` | Identifying but lower direct harm; higher false-positive rate. |
| `low`      | `email`, `custom`                                                                   | Commonly shared; user usually knows.                           |

Exact type→severity assignment lives in one pure map in the engine (mirroring `redactionKindFor` in
`redaction-ui.ts`) so backend, preview, and renderer agree. Severity is a **derived** property, not
stored on `RedactionEntry` — recompute it from `type` at render time so re-tiering never requires a
data migration.

### 4.2 Severity in the preview (P0)

- **Description**: The composer preview groups and colours candidates by severity instead of a flat
  list, so the most damaging item is visually first.
- **Priority**: P0
- **Acceptance criteria**:
    - Candidates render ordered by severity (`critical` → `low`), then by document position.
    - Each severity group has a distinct, token-based visual treatment using `--cog-*` tokens
    (no hardcoded colours); reuse/extend `cog-redacted-text` pill kinds rather than inventing new
    styling.
    - The existing per-item on/off toggle and manual "select text → Redact" flow are unchanged.
    - Copy is localised in all six locales.

### 4.3 First-run explainer (P0)

- **Description**: The first time redaction fires on a real draft, show a one-time explainer that
  teaches what happened, then never again.
- **Priority**: P0
- **Acceptance criteria**:
    - Gated on a new `redactionFirstRunSeen` boolean in `user_preferences.ts` (default `false`),
    persisted through `UserPreferencesService` like `redactionEnabled`.
    - Fires only when at least one candidate is detected on a draft, not on an empty composer.
    - Reuses the existing explainer modal machinery (`redactionModalLabels` / `cog-redacted-text`
    labels) rather than a bespoke dialog.
    - Dismissing sets `redactionFirstRunSeen = true`; it never reappears for that user.
    - Available again on demand from account settings (a "How redaction works" link) so dismissing
    is not destructive.
    - Localised in all six locales.

### 4.4 High-severity confirm on send (P1)

- **Description**: When a `critical`/`high` severity value would be sent **raw** (the user
  deselected it, or a future setting lets high-severity default to prompt), sending is gated by a
  confirm that names the category. This extends v1's existing `redactionWarningOpen` modal, which
  today only fires on any deselected item with uniform copy.
- **Priority**: P1
- **Acceptance criteria**:
    - When all detected candidates are selected for redaction (the default), send is **not**
    interrupted — the default path stays frictionless (honours `[[ux-simplicity-balance]]`).
    - When a `critical`/`high` candidate is deselected, the confirm names the category
    ("You're about to send a credit-card number unredacted") with Cancel / Send anyway /
    Redact & send, mirroring v1's three-way modal.
    - `low`/`medium` deselections keep v1's existing generic warning (or none, per current
    behaviour) — no new friction for low-severity items.
    - The confirm is driven purely off the derived severity map; no per-type conditionals scattered
    in the component.
    - Copy localised in all six locales.

## 5. Detection depth — structured additions (P1)

New Tier 1 detectors, all following v1's checksum-or-format precision rule and each shipping
positive **and** negative fixtures (spec v1 §17 "Detector tests must include negative cases").

| Type (new)           | Detector id         | Validation                                                                  |
| -------------------- | ------------------- | --------------------------------------------------------------------------- |
| Passport (generic)   | `passport:v1`       | Country-format allowlist for in-scope countries; format + length only.      |
| Driving licence (CH) | `ch-driving:v1`     | Swiss licence number format.                                                |
| PostFinance / bank   | `ch-postfinance:v1` | Swiss postal-account / PostFinance format + check digit where one exists.   |
| Date of birth        | `dob:v1`            | **Context-gated** (see §6) — date near DOB keywords only; never bare dates. |

Add new `RedactionType` members for these and extend the severity map (§4.1). All slot into
`TIER1_DETECTORS` and the existing overlap resolver unchanged.

## 6. Detection depth — context-aware middle tier (P1)

- **Description**: A tier _between_ checksum-certain (Tier 1) and NLP-fuzzy (Tier 2) that promotes
  weak structured signals when nearby keywords raise confidence, recovering recall v1 deliberately
  dropped for precision.
- **Priority**: P1
- **Rationale**: v1 does not catch a bare phone number without `+` (too false-positive-prone), nor
  DOBs, nor account numbers — all common in real prompts. Proximity to a signalling keyword makes
  them safe to catch.
- **How it works**:
    - A digit run of plausible length gains a candidate **only** when a signalling token appears
    within a small window (e.g. ±24 chars): `call|phone|tel|mobile|mob|fax` → `phone`;
    `dob|born|birth|d.o.b` → `dob`; `account|acct|a/c|iban|sort code` → account number.
    - Emitted at `medium` confidence, so — like Tier 2 — these are **surfaced but not silently
    redacted by default** unless the user opts the category in (mirrors v1 §8.3 Tier 2 handling).
    - Keyword lists are localised across the six languages (a French user writes "né le", a German
    "geboren am").
- **Acceptance criteria**:
    - A 7–11 digit run adjacent to a phone keyword is detected as `phone`; the same run in isolation
    is not.
    - A date adjacent to a birth keyword is detected as `dob`; a bare date is not.
    - Negative fixtures prove version strings, order numbers, and prose numbers are not promoted.
    - Keyword windows are tested per locale.

## 7. Detection depth — health category (P1)

- **Description**: A `health` category so the "we detected health data" promise in the launch TODO
  is real. Special-category data under GDPR Art. 9 — high trust value for a Swiss privacy product.
- **Priority**: P1
- **How it works**:
    - Structured where possible: Swiss health-insurance card number (EHIC/`80756…` format + check),
    plus any national health IDs already partially covered (`uk_nhs` re-tagged `high`/health).
    - Keyword-gated flag for medical prose (diagnosis/condition/medication terms) — this **flags**
    ("this looks like health information") at `medium` confidence rather than auto-redacting free
    text, because medical prose has no clean boundary. Presented as an advisory banner, not a
    pill.
    - Localised keyword lists across six languages.
- **Acceptance criteria**:
    - Swiss health-insurance card numbers are detected and classified `high` severity.
    - Medical-term proximity raises an advisory "health information detected" hint without mangling
    the sentence.
    - Negative fixtures: common words with medical homonyms do not trigger in non-medical context.

## 8. Detection depth — user allowlist (P2)

- **Description**: A user-scoped "never redact this value" list, the symmetric mirror of the
  existing user-scoped redaction store.
- **Priority**: P2
- **Rationale**: A value that trips a detector but is not sensitive to this user (an internal ID
  shaped like an IBAN) currently must be deselected on every message. Without an allowlist, users
  learn to ignore the preview — which erodes the whole feature.
- **How it works**: Store allowlisted `normalized` values sealed to the user key, exactly like the
  user-scoped redaction entries (`loadUserRedaction` path in `redaction.service.ts`). At detection
  time, drop candidates whose `normalized` is allowlisted for this user. "Never redact this" is an
  action on a preview pill; "Redact this again" reverses it from settings.
- **Acceptance criteria**:
    - Allowlisting a value removes it from the preview on subsequent drafts for that user only.
    - Allowlist is scoped to the user, sealed to their key, never sent in plaintext.
    - A settings surface lists allowlisted entries and can remove them.
    - Allowlist is applied **after** detection and **before** the preview, so it never affects other
    users or scopes.

## 9. Tier 2 NLP in a Web Worker (P1)

### 9.1 The worker (P1)

- **Description**: Move detection off the main thread and add the deferred `compromise` NLP layer
  there. Today `detectSensitiveText` runs synchronously on the main thread, mitigated only by a
  150ms composer debounce; v1 §21 flags "large pasted text blocks freeze composer" as an accepted
  risk. NLP over a large paste would make that unacceptable.
- **Priority**: P1
- **How it works**:
    - A new `redaction-detection.worker.ts` (pattern: existing `attachment-processing.worker.ts`)
    runs the full detector set — Tier 1, context tier, and Tier 2 — and posts back
    `RedactionCandidate[]`.
    - `compromise` (MIT, ~250KB, no model download, returns char offsets — v1 §8.2) is imported
    **inside the worker** and lazily, so its bundle cost is paid only when NLP is enabled and only
    off the main thread.
    - Tier 2 emits `person`/`org`/`place` at `low`/`medium` confidence. Per v1 §8.3 these are
    surfaced deselected and require explicit opt-in — unchanged.
    - The engine's pure functions stay pure and synchronous; the worker is a transport wrapper
    around them, so unit tests keep testing the pure engine directly with no worker.
    - The main thread keeps a tiny synchronous Tier 1 pass for the immediate live-highlight overlay
    (so the eye-icon highlight stays instant), while the worker produces the authoritative,
    NLP-inclusive candidate set that populates the preview list. Worker results supersede the
    synchronous pass when they arrive.
- **Acceptance criteria**:
    - Detection for a large paste does not block the main thread (composer stays responsive; no
    dropped frames on a mid-range laptop).
    - With NLP disabled, `compromise` is never loaded (verified by bundle/lazy-import assertion).
    - Worker returns candidates in the same `RedactionCandidate` shape; the engine/overlap resolver
    is unchanged.
    - If the worker fails to start or errors, detection **degrades to the synchronous Tier 1 path**
    rather than sending unredacted content — fail safe, never fail open.
    - A `nlpEnabled` preference (default TBD in §12) gates Tier 2; Tier 1 + context tier always run.

### 9.2 Incremental / chunked detection (P2)

- **Description**: For large inputs, detect on changed regions / in chunks rather than re-scanning
  the whole draft each debounce tick, and chunk attachment text so the worker yields.
- **Priority**: P2
- **Rationale**: v1's `<50ms/10k-char` budget passes today, but NLP and 100k-char attachment text
  (`prepareAttachmentText`, the truncation cap) are ~10× that. This is the strongest concrete driver
  for the worker and the natural home for the document-source path (v1 §6.9).
- **Acceptance criteria**:
    - Attachment text up to the 100k cap is detected without a main-thread stall.
    - Re-detection on an incremental edit does not re-scan the entire unchanged draft.
    - Correctness parity: chunked detection finds the same candidates as a single-pass scan on the
    corpus (§10).

## 10. Measurement (P0 for the harness, gating from Phase 2 on)

### 10.1 Labelled fixture corpus (P0)

- **Description**: A curated, privacy-safe corpus of realistic messages with ground-truth spans, so
  detection quality is measurable per detector. No production data — synthetic/curated only.
- **Priority**: P0
- **How it works**:
    - Fixtures live beside the engine (e.g. `redaction/corpus/*.json`): each entry is
    `{ text, expected: [{ start, end, type }] }`.
    - A scorer computes **precision** (of what we flagged, how much was truly sensitive) and
    **recall** (of what was truly sensitive, how much we caught) per detector type and overall,
    matching detected spans against expected spans.
    - Corpus covers all six locales and every detector, including deliberate near-misses (the
    negative fixtures already in `*-detectors*.spec.ts`, promoted into the corpus).
- **Acceptance criteria**:
    - Running the scorer prints per-type precision/recall and an overall number.
    - Every detector type has ≥ N positive and ≥ N negative fixtures (N agreed at build time).
    - The corpus contains zero real personal data (reviewed).

### 10.2 CI precision/recall gates (P0)

- **Description**: A CI test that fails the build if a detector's precision drops below a threshold,
  the same way v1's `<50ms` test guards latency.
- **Priority**: P0
- **Acceptance criteria**:
    - Tier 1 detectors must hold **precision ≥ 0.99** on the corpus (they are precision-first).
    - Context-tier and Tier 2 detectors have separate, lower, explicit thresholds (recall-oriented).
    - A new detector that tanks precision below its threshold fails CI.
    - Thresholds live in one place and are documented so a deliberate change is a conscious edit
    (pin-test discipline, per CLAUDE.md testing notes).

### 10.3 Privacy-safe local counters (P2)

- **Description**: Counts-only signals — never values — to reveal precision problems the corpus
  can't (e.g. a category users _always_ disable).
- **Priority**: P2
- **How it works**:
    - Increment client-side counters: per-type detection count, per-type user-deselect count,
    per-type allowlist count, NLP-enabled count. **No content, ever** — consistent with the
    "never log user data" rule and v1 §17 security NFRs.
    - Surfaced locally (or aggregated without content) for the team; opt-in and off by default, or
    strictly local — decision in §12.
- **Acceptance criteria**:
    - No counter carries a value, token, or normalized string — reviewed and tested.
    - A category with a high deselect ratio is visible as a precision signal.

## 11. Architecture deltas

Everything below is additive to v1's `frontend/src/app/redaction/` module; no v1 file's contract
changes.

```txt
frontend/src/app/redaction/
  redaction-types.ts          # + severity type, new RedactionType members
  redaction-severity.ts       # NEW: pure type→severity map (§4.1)
  redaction-detectors.ts      # + passport/licence/bank detectors (§5)
  redaction-detectors-context.ts  # NEW: keyword-proximity middle tier (§6)
  redaction-detectors-health.ts   # NEW: health structured + keyword flag (§7)
  redaction-detectors-nlp.ts       # NEW: compromise wrapper, worker-only (§9)
  redaction-detection.worker.ts    # NEW: worker transport around the pure engine (§9)
  redaction-engine.ts         # unchanged pure API; detector sets passed in
  corpus/                     # NEW: labelled fixtures (§10)
  redaction-score.ts          # NEW: precision/recall scorer (§10)
```

- The `Detector` interface, `RedactionCandidate`, token generator, `applyRedactions`,
  `hydrateRedactedText`, `redaction_entries` schema, key model, and public-share behaviour are all
  **unchanged**.
- Severity is derived, never persisted (§4.1) — no backend migration.
- The allowlist reuses the user-scoped seal-to-user-key path already in `redaction.service.ts`;
  no new collection unless the allowlist needs server persistence across devices (decision §12).

## 12. Open decisions

1. **NLP default** — off (v1's stance, opt-in per item) or on-but-clearly-uncertain? Recommend
   **off by default at launch**, opt-in via a preference, because Tier 2 precision is unproven until
   the corpus (§10) exists. Revisit once §10.2 shows Tier 2 precision.
2. **High-severity default behaviour** — should `critical`/`high` deselection be _possible_ at all,
   or always force-redact? Recommend keep deselect possible (user autonomy) but always route it
   through the §4.4 named confirm.
3. **Allowlist persistence** — device-local only, or synced (new sealed collection)? Recommend
   **synced/user-scoped sealed** for parity with existing user redaction entries, so it follows the
   user across devices.
4. **Counters** — strictly local, or opt-in aggregate? Recommend **strictly local first**; only add
   aggregate transport behind explicit consent if the team needs cross-user signal.
5. **Context-tier default selection** — surfaced-deselected (like Tier 2) or selected-by-default?
   Recommend **surfaced-deselected** until the corpus proves precision, then consider promoting
   phone-near-keyword to default-on.

## 13. Downstream / out of scope (noted, not built)

- **Image OCR → detect** on pasted images (relevant on `feat/image-pasting`): an image of a passport
  bypasses the text engine entirely. Logical next branch once OCR exists.
- **Heavier NER backend** (GLiNER/WebGPU): the worker boundary is designed to allow it later; not in
  this slice.
- **Multi-participant hydration** for redaction (sealed to sender only today) — tracked in
  `[[conversation-key-rotation-incomplete]]`; unchanged here.
- **Server-side / document-chunk redaction at scale** — the chunked path (§9.2) is the groundwork;
  full document ingestion stays in v1 §6.9's future scope.

## 14. Non-functional requirements (delta from v1 §17)

- **Performance**: main thread never blocks on detection; worker round-trip for a 10k-char draft
  stays imperceptible; NLP over a 100k-char attachment does not stall the UI. v1's `<50ms/10k-char`
  budget still holds for the synchronous Tier 1 fast pass.
- **Security**: unchanged v1 guarantees — no raw values off device, mappings under the separate
  redaction key, no raw values in logs/analytics/counters, cryptographic token randomness. The
  worker must not `postMessage` raw values anywhere except back to the originating main thread; it
  never has network access.
- **Reliability**: worker failure degrades to synchronous Tier 1 (fail safe). Allowlist/counter
  failures never block send and never fall back to sending raw content.

## 15. Testing plan (delta)

- **Unit**: severity map is exhaustive over `RedactionType`; new structured detectors have
  positive+negative fixtures; context-tier keyword windows tested per locale; health detector
  negative fixtures for medical homonyms; allowlist drops only the allowlisted `normalized` value
  and only for the user scope.
- **Worker**: candidate-shape parity with the synchronous engine; NLP not loaded when disabled;
  worker-error → synchronous fallback (asserted to never send raw); large-paste responsiveness.
- **Corpus/scoring**: scorer precision/recall correctness on a known mini-corpus; CI gate fails on a
  deliberately-broken detector; thresholds documented.
- **UX/e2e**: first-run explainer fires once and never again; severity ordering in preview;
  high-severity deselect triggers the named confirm; default (all-selected) send is not interrupted.
- **i18n**: every new string present in all six locales; context/health keyword lists localised.
- **Verify with the full `CI=true pnpm test`** after multi-file changes (isolated `vitest run` trips
  the CdkPortal JIT issue — see `[[testing-full-suite-vs-isolated-spec]]`).

## 16. Phases

| Phase | Deliverables                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------- |
| 1     | Severity model (§4.1), severity-in-preview (§4.2), first-run explainer (§4.3). Pure, low-risk, ships trust value. |
| 2     | Measurement harness (§10.1–10.2) — corpus + scorer + CI gates. Land **before** expanding detectors.               |
| 3     | Structured detector additions (§5) + context-aware tier (§6) + health (§7), each gated by the §10 corpus.         |
| 4     | Web Worker + Tier 2 NLP (§9.1), high-severity confirm (§4.4).                                                     |
| 5     | Allowlist (§8), chunked/incremental detection (§9.2), privacy-safe counters (§10.3).                              |

Rationale for the order: severity/first-run (Phase 1) is the cheapest path to the trust payoff the
launch TODO is chasing and needs no new detection. The measurement harness (Phase 2) lands _before_
new detectors (Phase 3) so recall expansion can't silently wreck precision. NLP+worker (Phase 4)
is the biggest recall gain but also the biggest complexity, so it follows the safety net. Allowlist
and chunking (Phase 5) are refinements once the core is proven.

## 17. Risks and mitigations (delta from v1 §21)

| Risk                                                        | Impact | Likelihood | Mitigation                                                                    |
| ----------------------------------------------------------- | ------ | ---------- | ----------------------------------------------------------------------------- |
| Tier 2 NLP floods preview with false positives              | Medium | High       | Off by default; surfaced-deselected; separate lower CI threshold; corpus.     |
| Context tier promotes ordinary numbers (dates, order ids)   | Medium | Medium     | Keyword windows + negative fixtures; surfaced-deselected until corpus proves. |
| High-severity confirm reintroduces friction users hate      | Medium | Medium     | Only on **deselected** high-severity; default all-selected send never gated.  |
| Worker adds complexity / init failure sends raw content     | High   | Low        | Fail safe to synchronous Tier 1; explicit no-fail-open test.                  |
| `compromise` bundle cost paid by users who never enable NLP | Low    | Medium     | Lazy-import inside worker; bundle assertion that it's absent when disabled.   |
| Corpus contains real PII                                    | High   | Low        | Synthetic/curated only; review gate; zero-real-data acceptance criterion.     |
| Counters leak values                                        | High   | Low        | Counts-only by construction; reviewed + tested no-value assertion.            |

## 18. Implementation checklist

Phase 1 — severity + UX

- [x] Add `severity` type + pure type→severity map (`redaction-severity.ts`).
- [x] Group preview by severity with `--cog-*` tokens; keep per-item toggle.
- [ ] Add `redactionFirstRunSeen` preference + first-run explainer reusing existing modal.
- [x] Add `redactionFirstRunSeen` preference storage.
- [x] i18n for shipped new copy in six locales.

Phase 2 — measurement

- [x] Build initial labelled corpus (`redaction/corpus/`) with synthetic fixtures.
- [x] Build precision/recall scorer (`redaction-score.ts`).
- [x] Add threshold gate test for the initial v2 corpus.
- [ ] Expand corpus to all detectors and all six locales before widening detector scope again.
- [ ] Raise Tier 1 thresholds to the full documented gate once corpus coverage is broad enough.

Phase 3 — detection depth

- [x] New structured detectors (§5) + `RedactionType` + severity map entries, with fixtures.
- [x] Context-aware middle tier (`redaction-detectors-context.ts`) + localised keyword lists.
- [x] Health detectors/flag (`redaction-detectors-health.ts`) + negative fixtures.

Phase 4 — NLP worker

- [x] `redaction-detection.worker.ts` transport around the pure engine.
- [x] `compromise` wrapper (`redaction-detectors-nlp.ts`), lazy inside worker.
- [x] Better-mode gate; worker-error → synchronous fallback.
- [x] Severity-aware confirm extending `redactionWarningOpen`.

Phase 5 — refinements

- [x] User allowlist (seal-to-user-key), settings surface, applied post-detect/pre-preview.
- [ ] Chunked/incremental detection for large drafts + attachment text.
- [ ] Privacy-safe local counters (counts only) + no-value test.

Cross-cutting

- [x] Update `docs/specs/pii-redaction.md` §23 "Deferred" list to point here as these land.
- [ ] Update `todo.md` "Sensitive-data detector" item as phases ship.
- [ ] Update `docs/security-model.md` if the worker/NLP change any user-facing privacy claim.
