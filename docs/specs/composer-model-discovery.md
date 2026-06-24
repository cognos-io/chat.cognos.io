# Model Defaults and Discovery

**Status:** Draft  
**Scope:** Frontend model defaults, model-picker UX, account settings model management, client-side
ranking/filtering, encrypted/local preferences  
**Related code:**

- `frontend/src/app/components/chat/message-form/model-selector/model-selector.component.ts`
- `frontend/src/app/components/account/data-processing/data-processing.component.ts`
- `frontend/src/app/services/model.service.ts`
- `frontend/src/app/services/user-preferences.service.ts`
- `frontend/src/app/interfaces/model.ts`
- `frontend/src/app/interfaces/user_preferences.ts`
- `frontend/src/app/i18n/model-copy.ts`
- `frontend/src/assets/i18n/{en,de,fr,es,it,pt}.json`
- `docs/security-model.md`
- `docs/i18n.md`

## 1. Overview

The composer model selector currently presents a growing list of models, with pinning and cost
visibility. As the catalogue expands, model names alone are not enough for users to quickly choose
the right model.

This work is about setting sane defaults and making it easy for people to find and use a specific
model when they need one.

This spec improves model discovery in both the compact composer selector and the more verbose model
list in user settings, while preserving Cognos' privacy posture:

- model search, filters, ordering, hiding, recent models, and defaults are resolved in the browser
- no composer/settings model search query is sent to the server
- no plaintext preference payload is stored server-side
- user-synced preferences continue to use the existing encrypted `user_preferences.data` blob
- all UI copy is localised across the supported languages

The product shift is from **model-name selection** to **default-first, purpose-aware selection**:

1. Users who know nothing get a good model from the start for the current purpose.
2. Users who are exploring can quickly understand each model's strengths and what to expect.
3. Users who know exactly what they want have their models at their fingertips at all times.

The primary audience is non-technical and slightly technical users, so the UI should choose sensible
defaults wherever possible rather than forcing users to understand model catalogues.

The composer implementation should stay compact and mobile-first. The account settings model list
can be more verbose and should act as the main management surface for defaults, hidden models, and
model preference review.

## 2. Target audience

### Users who know nothing about models

Users who do not know model names and should not need to. This is the primary audience. They should
start with a good model for the current purpose and be able to chat without opening the selector.

### Users who are exploring

Users who understand broad trade-offs such as faster, cheaper, more private, better for reasoning,
or able to generate images, but do not want to track provider/model naming. They need clear,
plain-language strengths, rough expectations, and safe recommendations.

### Users who know what they want

Users who frequently switch between specific models for cost, speed, reasoning, image generation,
privacy region, or quality. They need fast access through pinned models, recent models, search,
keyboard navigation, and defaults. Their controls must not make the default experience noisier for
everyone else.

### Privacy-sensitive users

Users who choose Cognos because they expect private-by-design behaviour. They need the model picker
to avoid leaking behaviour such as search terms, hidden models, favourite models, or project-level
preferences in plaintext.

## 3. Problem statement

The current selector is workable for a small catalogue, but becomes cumbersome as the list grows.
Users must visually scan model names and descriptions, and the list mixes unrelated intents such as
cost, hosting region, reasoning, image generation, and quality.

Current relevant behaviour:

- `ModelSelectorComponent` renders all eligible catalogue models in one compact composer list.
- `DataProcessingComponent` already renders a more verbose account settings model list with model
  descriptions, region badges, context size, and eligibility/locked states.
- It already supports pinned model IDs via `UserPreferencesService.pinnedModels()`.
- Pin order is frozen when the dropdown opens so rows do not jump while interacting.
- Image-generation mode filters models with `modelSupportsCapability(model, 'image_generation')`.
- Cost tiers are derived client-side from `model.pricing` with `deriveModelCostTier()`.
- Model descriptions are localised via `localizedModelDescription()` with catalogue fallback.
- `ModelService.selectModel()` also sets the user's default model through encrypted preferences.
- `UserPreferencesService` encrypts preferences client-side before storing them in PocketBase.

Cost of not solving this:

- users are asked to understand model differences before they can get value
- users choose suboptimal models because the desired capability is hard to find
- users overuse expensive/powerful models for simple tasks
- users miss privacy-region options such as Switzerland/EU-hosted models
- adding more catalogue models makes the composer feel increasingly noisy

## 4. Principles and constraints

### 4.1 Privacy-first requirements

- The browser performs all filtering, fuzzy search, sorting, grouping, hiding, and default
  resolution.
- Model-picker search terms must not be sent to the backend, analytics, logs, or third-party
  services.
- Prompt text must not be used for remote model ranking.
- If an "Auto" model mode is introduced later, its first version must use local, explainable rules
  only.
- User-specific preferences that sync between devices must live in the existing encrypted
  `user_preferences.data` payload, not in plaintext account fields.
- Local-only preferences may use browser storage only for non-key material. Do not store Account
  Keys, private keys, conversation keys, or plaintext chat content in browser storage.
- Backend model catalogue metadata is non-sensitive and may remain plaintext because it is public
  product configuration.

### 4.2 i18n requirements

Cognos ships in English, German, French, Spanish, Portuguese, and Italian. Every new user-facing
string must be added to:

- `frontend/src/assets/i18n/en.json`
- `frontend/src/assets/i18n/de.json`
- `frontend/src/assets/i18n/fr.json`
- `frontend/src/assets/i18n/es.json`
- `frontend/src/assets/i18n/it.json`
- `frontend/src/assets/i18n/pt.json`

Search should not depend only on translated UI strings. It should index stable model metadata and a
small local synonym dictionary per language where needed.

### 4.3 Default-first UX requirements

The product must serve three modes without asking users to choose a mode explicitly:

- **Know nothing:** pick a good eligible model automatically for the current purpose.
- **Exploring:** explain strengths and rough expectations in plain language.
- **Know exactly what they want:** keep pinned, recent, default, and searchable models one action
  away.

Requirements:

- Prefer a good default over asking the user to configure the model picker.
- The default composer state should work for users who do not know any model names.
- Keep advanced controls available but secondary, especially in the composer.
- Recommendations must be explainable in plain language, for example "Good for everyday chat" or
  "Best when you need image generation".
- Model rows should answer: what is this good for, what will it roughly cost, how private/where is
  it processed, and when should I choose it?
- Do not expose raw provider/model complexity unless it helps the user's decision.
- Settings may show more detail, but should still start with recommended/default choices first.
- If the app can infer a safe choice from non-sensitive local state, use it. Examples: active image
  tool → image-capable models; project default exists → use project default; user privacy tier →
  hide or de-emphasise unavailable models.

### 4.4 Accessibility requirements

- The selector remains keyboard usable.
- Opening the selector focuses the search input when search is present.
- Arrow keys move through visible model options.
- Enter selects the focused model.
- Escape closes the selector.
- Filter chips expose pressed state with `aria-pressed` or equivalent.
- Hidden/destructive actions are not only exposed on hover.
- The existing listbox/option semantics must not be broken by nested action buttons.

## 5. Core features

### 5.1 Sane contextual defaults

- **Description:** Select a sensible eligible model by default before the user has to think about
  model choice.
- **User story:** As a user who knows nothing about models, I want Cognos to start with a good model
  for what I am doing so that I can send a message without configuring anything.
- **Priority:** P0
- **Acceptance criteria:**
    - Fresh users get a recommended eligible model without opening the selector.
    - Default resolution prefers purpose and eligibility over catalogue order.
    - The default adapts to non-sensitive local context where available, for example active image
      tool,
    project default, user privacy tier, billing eligibility, and user default.
    - If a default cannot be used because it is hidden, ineligible, or unavailable, fallback is
      silent
    unless the user is already viewing model settings/selector details.
    - The chosen default is explainable in localised plain language when shown, for example "Good
      for
    everyday chat" or "Selected because image generation is on".
    - No prompt text is sent to the server or used by a remote ranking service to choose the
      default.

### 5.2 Client-side fuzzy search

- **Description:** Add a search input to the model selector. Search runs entirely in the browser
  over the loaded model catalogue and local metadata.
- **User story:** As a user, I want to search by model name, provider, capability, privacy region,
  or synonym so that I can find the right model without scanning the full list.
- **Priority:** P0
- **Acceptance criteria:**
    - Search matches `Model.name`, `Model.providerName`, `Model.description`,
      `Model.hostingCountry`,
    `Model.hostingRegion`, tags, cost tier, and derived capability labels.
    - Search handles common synonyms, for example `cheap` → low cost, `vision` → image,
    `smart`/`quality` → powerful, `private` → privacy-region tags.
    - Search is computed client-side and does not call an API.
    - Search terms are not persisted and not logged.
    - Empty search shows the default ordered model list.
    - No-result state is localised and suggests clearing filters/search.

### 5.3 Quick capability filters

- **Description:** Add filter chips above the model list for common intents.
- **User story:** As a user, I want one-click filters like Fast, Low cost, Reasoning, Image, and
  Long context so that I can narrow the list by task.
- **Priority:** P0
- **Acceptance criteria:**
    - Initial chips: Recommended, Fast, Powerful, Low cost, Reasoning, Image, Long context.
    - Recommended is selected by default unless the user has an active search/filter, pinned/default
    model, or required composer capability that should take precedence.
    - Add a privacy chip such as Switzerland or Private only if the catalogue metadata supports it
    clearly and consistently.
    - Filters are derived from public model metadata already present in `Model` or from a small
    frontend mapping keyed by model ID.
    - The Image filter reuses the existing `supportsImageGeneration` capability.
    - The Reasoning filter uses `reasoningEfforts.length > 0` unless a more explicit backend flag is
    added.
    - Low cost uses `deriveModelCostTier(model.pricing) === 'low'`.
    - Long context uses a documented threshold, initially `inputContextLength >= 128000`.
    - Fast, Powerful, and Recommended require explicit local metadata rather than guessing from
      name.
    - Filter labels use plain-language outcomes, not provider jargon.

### 5.4 Pinned, recent, and selected ordering

- **Description:** Preserve existing pinning and add recents so frequently used models are easier to
  reach without configuration.
- **User story:** As a frequent user, I want my pinned and recently used models near the top so that
  I can switch quickly.
- **Priority:** P0
- **Acceptance criteria:**
    - Existing pinned behaviour remains: pinned model IDs come first and row order is stable while
      the
    dropdown is open.
    - Selecting a model marks it as recent.
    - Recent models are de-duplicated, most-recent first, and capped at 8.
    - Pinned models are not duplicated in the Recent section.
    - The currently selected model is visible when it matches filters/search, with the existing
      check
    icon behaviour.
    - Recent model IDs are stored in encrypted preferences if synced, or in local browser storage if
      a
    local-only MVP is chosen.

### 5.5 Hidden models

- **Description:** Let users hide models they never want to see in the normal selector.
- **User story:** As a user, I want to hide irrelevant models so that the picker stays focused on my
  choices.
- **Priority:** P1
- **Acceptance criteria:**
    - Each model exposes a Hide action from an accessible overflow/menu action.
    - Hidden models are removed from the normal list, filters, and default ordering.
    - If the selected/default model becomes hidden, selection falls back to the next eligible
      visible
    model.
    - Search no-result state can offer "show hidden matches" when hidden models match the query.
    - The composer exposes Hide as a secondary action, not as a primary row affordance.
    - The account settings model list is the primary management surface for hidden models, including
    unhide individual models and reset all hidden models.
    - Hidden IDs are not stored in plaintext on the server.

### 5.6 User default model

- **Description:** Make default-model behaviour explicit in the UI rather than only implicit on
  select, while ensuring users get a sane default even if they never configure one.
- **User story:** As a user, I want Cognos to start with a sensible model and let me set my own
  default when I care, so that new chats work well without setup.
- **Priority:** P1
- **Acceptance criteria:**
    - UI exposes "Set as my default" for eligible models.
    - The composer may expose this as a compact secondary action; the account settings model list
      must
    expose it more explicitly.
    - Current default is labelled in both the composer selector and the account settings model list.
    - `ModelService.selectedModel` fallback order becomes:
explicit session pick → encrypted project default → encrypted user default → recommended eligible
model → first eligible visible model.
    - Default model ID remains in encrypted `user_preferences.data` through `defaultModelId`.
    - No plaintext account/user field is added for model defaults.

### 5.7 Project default model

- **Description:** Allow a project to define a default model for conversations created in that
  project, without revealing the choice in plaintext.
- **User story:** As a project member, I want a project-specific default model so that project chats
  use the model appropriate for that workspace.
- **Priority:** P2
- **Acceptance criteria:**
    - Project default is stored inside encrypted project metadata, not as a plaintext project field.
    - Resolution order is documented and tested:
    1. explicit model selected for this chat/session
    2. encrypted project default, when in a project and eligible
    3. encrypted user default, when eligible
    4. recommended eligible model
    5. first eligible visible model
    - If the project default is not eligible for the user's privacy tier or billing state, the UI
      shows
    a localised fallback explanation.
    - Existing project encryption principles in `docs/specs/projects.md` are preserved.

### 5.8 Model strengths and expectations

- **Description:** Make capabilities, strengths, and rough expectations scannable without relying on
  long descriptions.
- **User story:** As a user who is exploring models, I want to understand what each model is good
  for and what trade-offs to expect so that I can choose confidently.
- **Priority:** P1
- **Acceptance criteria:**
    - Existing cost lozenges remain hidden for unlimited plans.
    - Capability labels use localised copy and existing `TagComponent`/`CognosLozengeComponent`
    patterns where appropriate.
    - Rows make model strengths clear with concise labels such as Everyday, Fast, Reasoning, Image,
    Long context, Low cost, or Private/Swiss/EU where supported.
    - Rows communicate rough expectations without precise benchmarking claims, for example cost
      tier,
    context size, privacy region, and whether the model is better suited to simple or demanding
    tasks.
    - Descriptions remain available but do not dominate the row.
    - Ineligible models keep showing their localised ineligibility reason when available.

### 5.9 Account settings model management

- **Description:** Reflect the same discovery and preference behaviour in the account settings model
  list, using the extra space there for more explanatory controls.
- **User story:** As a user, I want to manage model preferences in settings so that the compact
  composer stays quick while settings gives me a fuller overview.
- **Priority:** P1
- **Acceptance criteria:**
    - The account settings model list supports the same search and quick filters as the composer.
    - Settings shows the same pinned, hidden, recent, default, capability, cost, privacy-region, and
    eligibility state as the composer.
    - Settings provides clearer actions for Pin/Unpin, Hide/Unhide, Set as my default, and Reset
      hidden
    models.
    - The composer and settings list share the same pure filtering/ordering logic rather than
      drifting
    into separate behaviours.
    - Settings can show fuller descriptions, context size, provider/hosting details, and explanatory
    privacy copy because it is not constrained by the composer footprint.
    - Mobile settings remains usable: controls may stack, but no model action is hover-only.
    - Any preference changed in settings is immediately reflected in the composer without a full
      page
    reload.

### 5.10 Optional future: Auto model mode

- **Description:** Provide an "Auto" option that picks a model via transparent client-side rules.
- **User story:** As a non-technical user, I want Cognos to pick a sensible model so that I do not
  need to understand the catalogue.
- **Priority:** P2 / future
- **Acceptance criteria:**
    - Auto mode is opt-in or clearly labelled.
    - Auto mode should be considered if repeated usability testing shows users still hesitate at
      model
    choice even after search, filters, and recommended defaults.
    - First version uses only local rules: active composer tool, attachments, selected filters,
    privacy tier, billing eligibility, project default, and user preference.
    - Auto mode does not send prompt text or search data to the backend for ranking.
    - The UI explains why a model was selected, for example "Selected because image generation is
      on".

## 6. Data model and storage

### 6.1 Existing model catalogue

The current frontend `Model` type already includes useful metadata:

```txt
id
name
slug
providerId
providerName?
description
privacyTier
tags
contentTypes
inputContextLength
maxOutputTokens?
pricing
noRetention?
isOpenSource?
hostingCountry?
hostingRegion?
supportsImageGeneration
reasoningEfforts
defaultReasoningEffort?
isEligible
ineligibilityReason?
```

Search/filtering should use this first before requesting backend schema changes.

### 6.2 Proposed frontend-only capability metadata

Some UX labels cannot be derived safely from current fields. Add a small local mapping keyed by
model ID, for example:

```txt
recommended: boolean
recommendedDefaultFor: Array<'chat' | 'image' | 'reasoning' | 'long_context'>
fast: boolean
powerful: boolean
strengths: string[]
expectationKey: string
aliases: string[]
```

Rules:

- keep this metadata non-sensitive and deterministic
- use it to support defaults, exploration, and fast retrieval of known models
- do not infer quality from price unless explicitly product-approved
- ensure labels are reviewed when catalogue entries change
- all displayed labels, expectation copy, and aliases used for visible UI need i18n support

If this mapping grows too large or needs backend ownership, expose it as public catalogue metadata
in `/api/v1/models`; it must remain product metadata, not user-specific data.

### 6.3 User preferences

Existing encrypted preferences:

```txt
pinnedModels: string[]
defaultModelId: string
modelReasoningEfforts: Record<string, string>
```

Proposed additions:

```txt
recentModels: string[]
hiddenModels: string[]
```

Rules:

- These fields belong in `UserPreferencesData` and therefore in encrypted `user_preferences.data`.
- Defaults must be backward compatible in Zod, as existing preferences will not contain these keys.
- IDs should be treated as stale-safe: unknown model IDs are ignored at read time.
- Recent and hidden model lists should not expose model preference data in plaintext server fields.

### 6.4 Local-only alternative

A lower-complexity MVP may store `recentModels` and `hiddenModels` in browser storage. If used:

- use a namespaced key such as `cognos:model-selector:<user-id>`
- store only model IDs and UI state, never key material or message content
- document that these preferences do not sync across devices
- keep the shape compatible with later encrypted preference sync

The preferred long-term implementation is encrypted sync via `UserPreferencesService`.

## 7. Ordering and filtering model

The composer selector and account settings model list should share the same underlying filtering and
ordering helpers. The composer may render a compact subset of controls; settings may render a more
verbose management view.

The visible rows should be built with this pipeline:

```txt
1. Start with ModelService.modelList()
2. Remove models that do not support requiredCapability
3. Remove hidden models unless "show hidden" is active
4. Remove ineligible models only when a filter explicitly asks for usable models; otherwise keep
   current disabled-row behaviour
5. Apply active quick filter
6. Apply fuzzy search query
7. Partition/order:
   a. selected model, if visible and not already pinned
   b. pinned models, in user pin order
   c. recent models, most-recent first
   d. recommended models
   e. remaining models in catalogue order
8. If no explicit/default model is available, preselect the first recommended eligible model before
   falling back to the first eligible visible model
```

Pinned order should continue to be frozen when the dropdown opens to avoid row jumps.

## 8. Non-functional requirements

- **Performance:** filtering and search should update within 50 ms for a catalogue of 500 models on
  a mid-range laptop. The selector should not block typing in the composer.
- **Security:** search terms, hidden models, recent models, pinned models, defaults, and project
  defaults must not be stored in plaintext on the server. No plaintext chat content is introduced by
  this feature.
- **Scalability:** the client-side approach must comfortably handle a 10x catalogue increase without
  backend search infrastructure. If catalogue size exceeds 500 models, add a memoised search index
  rather than a server endpoint.
- **Reliability:** stale preference IDs must be ignored safely. A broken preference payload should
  fail closed to the existing default model fallback rather than blocking chat.
- **Accessibility:** keyboard and screen-reader behaviour must be covered by component tests and at
  least one Playwright flow.
- **Internationalisation:** translation parity tests must pass after adding keys.

## 9. Success metrics

| Metric                                             | Target                                                                                                                                 | Measurement method                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Time to first useful chat                          | Fresh users can send their first message without opening the model selector                                                            | Usability script / Playwright happy path                             |
| Model selection time in usability script           | Median under 10 seconds for "find an image/reasoning/low-cost model" tasks with non-/slightly-technical users                          | Manual UX script or Playwright-assisted timing in a seeded catalogue |
| Zero server calls during search/filter interaction | 0 API requests after catalogue load while typing/filtering                                                                             | Playwright network assertions                                        |
| Translation coverage                               | 100% key parity across `en/de/fr/es/it/pt`                                                                                             | `translation-parity.spec.ts`                                         |
| Preference plaintext leakage                       | 0 new plaintext user/project fields for recents, hidden models, or defaults                                                            | Code review + API e2e assertions                                     |
| Keyboard completion                                | User can open selector, search, move, select, and close without mouse                                                                  | Playwright e2e                                                       |
| Default acceptance                                 | At least 70% of test users can start a chat without changing model and describe the default as reasonable                              | Usability script / product review                                    |
| Exploration comprehension                          | At least 80% of test users can identify which model is better for image, reasoning, low-cost, and private use cases from the UI labels | Usability script / product review                                    |

## 10. Testing requirements

Follow the project preference for high-level e2e tests first, then unit tests for pure logic.

### 10.1 Browser e2e tests

Add or extend tests under `frontend/e2e/`:

- `models.spec.ts` or new `model-selector-discovery.spec.ts`
- account settings model-list coverage in `account-*` or a dedicated `account-models.spec.ts`
- fresh user can start a chat with the recommended default without opening the model selector
- search by model name
- search by provider
- search by capability synonym
- filter by image and verify non-image models are hidden
- filter by reasoning and verify only models with reasoning efforts appear
- model rows expose strengths/expectations clearly enough to distinguish common use cases
- hide a model and verify it disappears from the normal list
- show/manage hidden models and unhide
- set default model in the composer and verify it is restored after reload/unlock
- set default model in account settings and verify the composer reflects it
- hide/unhide models in account settings and verify the composer reflects it
- verify no network request is made while typing into the search box after initial catalogue load
- verify keyboard-only selection path

### 10.2 API e2e tests

Extend API tests only where encrypted preference persistence changes:

- preferences payload remains opaque ciphertext in PocketBase/API responses
- no plaintext `recentModels`, `hiddenModels`, or project model default field is exposed
- stale/unknown model IDs in encrypted preferences do not break `/api/v1/models` or chat startup

### 10.3 Unit tests

Add pure tests for:

- model search index/query matching
- contextual default resolution for fresh users, image mode, project default, user default, hidden,
  and ineligible models
- capability filter predicates
- ordering pipeline with selected, pinned, recent, recommended, hidden, and ineligible models
- default resolution prefers recommended eligible models before generic first eligible fallback
- Zod defaults for new preference fields
- recent model de-duplication and cap
- hidden model fallback when default/selected is hidden
- i18n translation parity

## 11. Implementation milestones

| Phase                                              | Duration  | Deliverables                                                                                                                                                     |
| -------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1: Search, filters, and recommended defaults | 1 week    | Client-side search input, filter chips in composer and settings, shared pure filtering/order tests, recommended default fallback, i18n keys, Playwright coverage |
| Phase 2: Recents and hidden models                 | 1 week    | `recentModels`, `hiddenModels`, encrypted preference schema defaults, composer hide action, settings hide/unhide management, tests                               |
| Phase 3: Explicit defaults                         | 1 week    | "Set as my default" UI in composer/settings, default labels, fallback tests, encrypted preference assertions                                                     |
| Phase 4: Project defaults                          | 1-2 weeks | encrypted project default metadata, resolution order, project settings UI, access/encryption tests                                                               |
| Phase 5: Auto mode                                 | later     | local-rule Auto option with transparent explanation and privacy review                                                                                           |

## 12. Risks and mitigations

| Risk                                                                                                  | Impact | Likelihood | Mitigation                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| The selector becomes visually overloaded with search, chips, pins, defaults, hide actions, and badges | High   | Medium     | Keep default view compact; move hide/default actions into an accessible overflow menu; test on mobile widths                                   |
| Capability labels are misleading because `fast` and `powerful` are subjective                         | Medium | High       | Use explicit curated metadata; do not infer from names or cost; review labels when catalogue changes                                           |
| Sane defaults are wrong for some users                                                                | Medium | Medium     | Make defaults easy to override, keep recommendations explainable, and prefer privacy/billing eligibility constraints before capability ranking |
| Preference changes accidentally add plaintext server fields                                           | High   | Low        | Store synced preferences only in encrypted `user_preferences.data`; add API/code-review checks                                                 |
| Nested row actions break listbox accessibility                                                        | Medium | Medium     | Revisit markup so row selection and per-row actions have valid keyboard semantics; cover with tests                                            |
| Search quality varies by language                                                                     | Medium | Medium     | Start with stable metadata plus translated synonyms; use i18n parity tests; avoid relying only on English descriptions                         |
| Hidden default model creates confusing fallback behaviour                                             | Medium | Medium     | Show localised fallback copy and provide a clear reset/unhide path                                                                             |

## 13. Open decisions

1. Should `recentModels` and `hiddenModels` ship as encrypted synced preferences immediately, or as
   a local-only MVP with later encrypted sync?
2. Should the composer expose Hide/Set default directly in its compact row actions, or only through
   a secondary overflow menu while settings remains the primary management surface?
3. What is the product-approved curated set for `recommended`, `fast`, and `powerful` labels?
4. Should selecting a model continue to implicitly set the default, or should default-setting become
   explicit? Current code persists selection as `defaultModelId`; changing this is a behavioural
   change and needs product confirmation.
5. Which model or curated set should be the first recommended default for each privacy tier/billing
   state?
6. What exact threshold defines "long context" for the first release?

## 14. Non-goals

- Server-side personalised recommendations.
- Server-side search endpoints for model picker queries.
- Sending prompt text to a ranking service.
- Logging model search terms or filter usage with user identifiers.
- Reworking the backend provider catalogue beyond optional public metadata additions.
- Building a full model comparison page.
