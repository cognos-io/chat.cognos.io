# Individual Adoption Journey

**Status:** Implemented baseline — current real-export fixture confirmation and final browser-suite
rerun pending  
**Audience:** Privacy-conscious individuals and individual professionals  
**Scope:** Activation, early habit formation and encrypted Conversation import. Team and B2B
administration are deferred to a second pass.

## 1. Overview

Cognos already has substantial privacy and chat capability, but new Account holders still have to
translate those capabilities into a useful personal routine. This initiative creates a smooth path
from signup to a meaningful first Conversation, explains privacy at the moment it matters, and
helps Account holders return with a clear next task.

The product will first improve the native journey from signup to repeated use. Import from ChatGPT
and Claude follows as a migration path for people who have existing history and want continuity.
Import is not the first release: it has more security, compatibility and support risk, while the
native journey tests the more fundamental question of whether Cognos becomes a habit.

The experience must earn trust without asking an Account holder to trust a slogan. It will explain
what Cognos protects, what Cognos and a Provider can see during a Completion, and what losing the
Account Key means at the relevant decision points. It must never imply that Cognos cannot see
Message content while a Completion is being processed.

## 2. Target Audience

### Privacy-conscious individual

They already use an AI chat application but avoid sensitive subjects, regularly delete history, or
use temporary modes because they do not trust long-term storage. They want useful continuity
without leaving a readable archive behind. Their adoption barrier is trust, followed by the effort
of establishing a new routine.

### Independent professional

They work alone or in a small practice and use AI for drafting, research, planning, reflection and
document analysis. Their work may contain client, patient, financial or commercially sensitive
information. They need an honest boundary between encrypted stored history and the transient
plaintext processing required for a Completion. This phase serves the individual professional
Account only; it does not promise team policy, administration or enterprise controls.

### Privacy upgrader with existing history

They have valuable Conversations in ChatGPT or Claude and perceive switching as losing context and
past work. They need a guided way to bring supported text history into Cognos without uploading the
raw export to Cognos or leaving imported plaintext on the server.

## 3. Problem Statement

The current product asks a new Account holder to complete a demanding trust ceremony and then
decide what to do in a feature-rich chat interface. Privacy features are valuable, but features
alone do not create an adoption journey. An empty state, uncertainty about what is safe to share,
and the cost of abandoning useful history all encourage a return to a familiar competitor.

The product must solve three connected problems:

1. **Time to value:** help the Account holder complete one personally meaningful task quickly.
2. **Trust calibration:** make the real privacy boundary understandable before more sensitive use,
   without interrupting every Conversation.
3. **Continuity:** let established users retain useful history when switching, while maintaining
   Cognos's encryption and data-minimisation guarantees.

The cost of not solving these problems is a high signup-to-first-Message drop-off, shallow trial
usage, and Account holders who admire the privacy proposition but never build a Cognos habit.

## 4. Core Features

### 4.1 Guided first-value journey

- **Description:** After the Account Key ceremony, show a short, skippable welcome journey that
  asks what the Account holder wants to accomplish rather than collecting personal details. Offer
  three initial paths: start a private Conversation, bring existing Conversations, or explore
  privacy controls. For the native path, offer task starters for everyday private thinking and
  individual professional work. A chosen starter pre-fills the composer but never sends without an
  explicit action.
- **User Story:** As a new Account holder, I want a relevant starting point so that I can experience
  value without learning every Cognos feature first.
- **Priority:** P0
- **Acceptance Criteria:**
    - The journey appears after the Account Key has been saved and can be skipped without losing
    access to the normal app.
    - No step asks for profession, employer, client name, health status or other personal profile
    data; the selected path is held locally and is not added to Account metadata.
    - Starters cover at least one everyday privacy task and one individual professional task, use
    translated copy in all six supported languages, and never contain prefilled sensitive data.
    - Selecting a starter opens a temporary or persisted Conversation as explicitly labelled and
    places editable text in the composer; it never triggers a Completion automatically.
    - The existing Account Key and email-verification requirements are neither hidden nor bypassed.
    - Browser E2E tests cover complete, skip, back, refresh and keyboard-only journeys.

### 4.2 Contextual trust guidance

- **Description:** Explain the privacy boundary where an Account holder chooses persistence,
  privacy tier, Redaction or import. Use progressive disclosure: a concise statement first, with a
  link to the full security explanation. Do not add a long generic privacy tour.
- **User Story:** As a privacy-conscious Account holder, I want to understand what happens to my
  information at the moment I act so that I can make an informed choice.
- **Priority:** P0
- **Acceptance Criteria:**
    - Before the first persisted Conversation, the UI states that stored Message content is
      encrypted
    and that Cognos and the selected Provider process plaintext during a Completion.
    - The privacy-tier control explains the hosting ceiling without claiming that all data remains
      on
    the device.
    - Temporary Conversation, persisted Conversation and Redaction are explained as distinct
      choices.
    - Trust guidance is dismissible, remains available from the relevant control, and is translated
    in all six supported languages.
    - Accessible names, live regions, focus order and disclosure state are verified in component and
    browser tests.
    - Copy remains aligned with `docs/security-model.md` and the marketing plain-language rules.

### 4.3 Early habit loop

- **Description:** Replace the generic empty state with a small, locally maintained set of next
  actions: complete a first useful Conversation, try a second use case, and return during the
  following week. Recent Conversation access remains the primary return path; reminders are
  in-product only in this phase, with no behavioural email campaign or notification permission
  prompt.
- **User Story:** As a new Account holder, I want a clear next useful action so that Cognos becomes
  part of my routine rather than a product I try once.
- **Priority:** P0
- **Acceptance Criteria:**
    - A new Account sees at most three next actions and can dismiss the module permanently on that
    device.
    - Progress is calculated in the browser from events the Account holder already causes; task
      text,
    Conversation titles and Message contents are never inspected for onboarding progress.
    - Completing an action updates without a page reload and does not block normal chat use.
    - Returning Account holders land on their normal recent-Conversation experience, not a forced
    onboarding screen.
    - No reminder email, push notification or per-Account behavioural profile is introduced in this
    phase.
    - Browser tests cover first completion, return visit, dismissal and local-state corruption.

### 4.4 Encrypted Conversation import

- **Description:** Provide an import flow with a source selector for ChatGPT or Claude, source-
  specific export instructions, local validation and parsing, a preview, and client-side encryption.
  The raw export never uploads to Cognos. Only encrypted Conversation metadata and encrypted
  Messages are persisted. V1 imports supported text Conversations; unsupported artefacts are
  reported before confirmation rather than silently discarded.
- **User Story:** As an Account holder with useful history elsewhere, I want to import supported
  Conversations without sending Cognos my raw export so that switching does not mean starting over.
- **Priority:** P1
- **Acceptance Criteria:**
    - The entry screen requires the Account holder to select ChatGPT or Claude before showing
      current,
    translated export instructions and accepted file types.
    - Parsing and preview run entirely in a dedicated browser worker; network tests assert that the
    selected raw file and its plaintext are never sent to Cognos, analytics or a third party.
    - The importer validates archive size, expanded size, entry count, paths, nesting depth and JSON
    shape before parsing; malformed archives, path traversal, decompression bombs and unsupported
    schema versions fail closed with actionable translated errors.
    - Preview shows counts and locally rendered titles, dates and unsupported-item warnings. It
      allows
    selecting Conversations but never includes titles, filenames, dates or counts in analytics.
    - Every imported Conversation receives a fresh Conversation key and valid Participant record.
    Metadata and every supported Message are encrypted before persistence. The backend receives no
    plaintext historical Message content.
    - Imported history is not sent to a Provider during import. It reaches a Provider only if the
    Account holder later continues that Conversation through a Completion.
    - V1 supports text roles that map safely to Cognos `user` and `assistant` Messages. Attachments,
    generated images, tool records, shared links and source-specific system metadata are excluded
    with a pre-confirmation summary; no unsupported content is silently dropped.
    - Source ordering and supported branch relationships are preserved where the source export makes
    them unambiguous. Ambiguous branches are imported as separately labelled Conversations.
    - Import is resumable only from encrypted staged records or by reselecting the local file; raw
    plaintext is not placed in `localStorage`, IndexedDB, logs, error reports or analytics.
    - Cancelling removes local plaintext references and partial server writes are rolled back or
    removed. Tests cover cross-Account denial and prove one Account cannot read another Account's
    imported ciphertext records.
    - Browser E2E fixtures cover sunny, rainy and edge exports for both sources without containing
      real
    personal data.

### 4.5 Adoption measurement without behavioural profiles

- **Description:** Extend the privacy-respecting analytics catalogue with one-time adoption
  milestones computed locally. This provides directional beta evidence without persistent device
  identifiers, Account IDs or Message-derived properties.
- **User Story:** As a privacy-conscious Account holder, I want product improvement measurement to
  respect the same privacy principles as the product so that adoption work does not undermine
  trust.
- **Priority:** P0
- **Acceptance Criteria:**
    - The event catalogue adds `adoption_milestone` with the sole prop `milestone`, restricted to
    `first_message_24h`, `three_conversations_7d` and `week_2_return`.
    - Each milestone is emitted at most once per browser profile and contains no timestamp, Account
    identifier, Message content, Conversation identifier, title, profession or source filename.
    - DNT and GPC remain a hard no-op, analytics failures never affect the journey, and local
      milestone
    state can be cleared with normal site-data controls.
    - The dashboard labels the figures as aggregate directional counts; it does not describe them as
    exact per-Account cohort retention.
    - Founder-supported beta interviews separately ask whether Cognos feels trustworthy and what
    caused or prevented a return, with explicit consent and no Message-content collection.

## 5. Non-Functional Requirements

- **Performance:** The guided journey must add less than 100 ms of main-thread work on a median
  supported device. Import parsing and encryption must run off the main thread, keep interaction
  responsive, show determinate progress where the source format permits it, and support at least a
  250 MB compressed export or 10,000 text Messages after validation. Limits must be configurable and
  displayed before file selection.
- **Security:** Raw exports and plaintext imported history remain in browser memory only. No
  plaintext content, key material, titles, filenames or import error payloads may enter logs or
  analytics. Imported data uses the existing Conversation encryption and Participant authorisation
  model. File parsing is hostile-input handling and requires a threat-model review before release.
- **Scalability:** V1 is designed for the 20–50 Account-holder beta and bounded client-side imports.
  Encrypted persistence uses batches with an idempotency token and strict server limits so retries
  do not duplicate Conversations. Large asynchronous server-side plaintext import is explicitly
  excluded.
- **Reliability:** Native onboarding never blocks access to chat. Import confirmation is all-or-
  nothing per selected Conversation, reports failures without content, and allows safe retry.
  Compatibility fixtures pin each supported export schema; an unrecognised source change fails
  closed rather than guessing.
- **Accessibility and i18n:** All interaction is keyboard-operable, progress is conveyed without
  colour alone, status changes use appropriate live regions, focus is restored after dialogs, and
  every user-visible or assistive-technology string ships in `en`, `de`, `fr`, `es`, `pt` and `it`.
  Visual implementation uses existing `@cognos/ui-angular` components and `--cog-*` tokens.

## 6. Success Metrics

The first 20–50 founder-supported beta Account holders form the evaluation cohort. Plausible remains
cookieless and aggregate-only, so the product figures below are directional count ratios rather
than exact identity-linked cohorts. Interviews provide the qualitative cross-check.

| Metric              | Target                                                                                                    | Measurement Method                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| First value         | At least 70% send a first Message within 24 hours of signup                                               | `adoption_milestone {first_message_24h}` divided by `signup_completed`, cross-checked against the existing same-session activation funnel |
| Week-two return     | At least 40% return during days 8–14                                                                      | `adoption_milestone {week_2_return}` divided by `signup_completed`; label as directional because no Account identity is linked            |
| Purposeful breadth  | At least 25% create and use three Conversations within seven days                                         | `adoption_milestone {three_conversations_7d}` divided by `signup_completed`, computed locally from content-free actions                   |
| Trust comprehension | At least 80% correctly explain encrypted storage versus in-flight processing                              | Short consented beta interview question; record only aggregate pass/fail and themes, never Message content                                |
| Journey reliability | At least 98% of native journey attempts complete without a product error                                  | Content-free journey error/success events using closed-enum reasons                                                                       |
| Import integrity    | 100% of supported fixture Messages decrypt correctly after import; zero plaintext export network requests | Automated fixture round-trip tests plus Playwright network assertions                                                                     |
| Import completion   | At least 80% of beta Account holders who reach a valid preview complete the import                        | Aggregate `import_previewed` and `import_completed` events with source as the only closed-enum prop                                       |

## 7. Timeline & Milestones

| Phase                               | Duration                 | Deliverables                                                                                                                                               |
| ----------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Journey specification and red tests | 1 week                   | Approved journey copy and wire flow; analytics catalogue update; Playwright tests for native journey; import threat model and synthetic source fixtures    |
| Native activation release           | 2 weeks                  | Guided first-value journey, contextual trust guidance, local habit loop, six-language catalogues, accessibility coverage and milestone dashboard           |
| Observe and refine                  | 2 weeks                  | Founder-supported beta with 20–50 Account holders; weekly funnel review; interview findings; fixes to the largest observed native-journey drop-off         |
| Import beta                         | 3 weeks                  | ChatGPT and Claude source selector and instructions, worker-based parser, encrypted batch persistence, preview/warnings, round-trip and hostile-file tests |
| Adoption checkpoint                 | 1 week after import beta | Continue/change/stop decision against the metrics above; prioritised second-pass B2B discovery without promising team features                             |

The import beta does not begin until the native journey is instrumented and the security review has
approved the raw-export boundary. Source export formats must be verified against fresh synthetic
exports immediately before implementation because third-party formats can change without notice.

## 8. Risks & Mitigations

| Risk                                                                               | Impact | Likelihood | Mitigation                                                                                                                               |
| ---------------------------------------------------------------------------------- | ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Trust copy overstates protection during a Completion                               | High   | Medium     | Require security-model review of every new privacy statement and test canonical phrases across all six catalogues                        |
| Onboarding feels like friction after an already demanding Account Key ceremony     | High   | Medium     | Keep it skippable, ask one intent question, prefill without auto-sending, and remove steps that do not improve measured activation       |
| Habit mechanics feel manipulative or invasive                                      | High   | Medium     | Use at most three dismissible in-product actions, no streaks, no behavioural email and no content inspection                             |
| Imported plaintext leaks through upload, logging, analytics or browser persistence | High   | Medium     | Worker-only local parsing, network deny assertions, hostile-input review, memory-only plaintext and ciphertext-only API contracts        |
| ChatGPT or Claude changes its export schema                                        | Medium | High       | Versioned parsers, pinned synthetic fixtures, current instructions, explicit compatibility errors and fail-closed handling               |
| Large or malicious archives freeze the browser or exhaust memory                   | High   | Medium     | Validate compressed and expanded bounds before parsing, stream where possible, use a worker, cap entries/depth and allow cancellation    |
| Import silently loses source-specific content or branch structure                  | High   | Medium     | Preview unsupported counts, require confirmation, preserve unambiguous branches and split ambiguous branches into labelled Conversations |
| Aggregate analytics overstate exact retention                                      | Medium | High       | Label metrics directional, use one-time local milestones, retain DNT/GPC opt-out and triangulate with consented interviews               |
| Migration work delays proof that Cognos is useful on its own                       | High   | Medium     | Ship and observe the P0 native journey before starting the P1 import beta                                                                |

## 9. Implementation Evidence

- [x] Post-Emergency-Kit, refresh-safe first-value journey with translated starters, explicit send
      and contextual trust guidance.
- [x] Content-blind, dismissible three-step habit module with Account-scoped local state.
- [x] One-time `adoption_milestone` analytics with no Account identifier or content props.
- [x] ChatGPT/Claude source selector and current official export instructions in all six locales.
- [x] Dedicated network-free worker, transferable buffer, cancellation and no plaintext browser
      persistence.
- [x] ZIP central-directory validation, safe paths, entry/expanded-size bounds and streaming
      decompression.
- [x] Strict source adapters, branch splitting, unsupported-item counts and property tests.
- [x] Fresh Conversation keys, encrypted title and Message payloads before upload.
- [x] Atomic authenticated import endpoint, creator/Admin Participant, locked idempotency receipts,
      graph validation and neutral cross-Account denial.
- [x] Frontend unit/property suite, production build, lint, Go handler tests and auth-surface tests.
- [ ] Re-run the focused browser/API import suites and full browser regression suite after
      local-port execution approval is available. The API round-trip completed its functional
      assertions; its first run failed only in test cleanup, which is fixed.
- [ ] Confirm both adapters against newly generated, synthetic current exports from ChatGPT and
      Claude before enabling the import beta. Official documentation confirms the export steps and
      ChatGPT `conversations.json` filename but does not publish either JSON schema, so parsers fail
      closed on unknown structures.

Official guidance checked 11 July 2026:

- [OpenAI: export ChatGPT history and data](https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data)
- [Anthropic: export Claude data](https://support.anthropic.com/en/articles/9450526-how-can-i-export-my-claude-data)
