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
- `frontend/src/app/interfaces/project.ts`
- `frontend/src/app/services/project.service.ts`
- `frontend/src/app/i18n/model-copy.ts`
- `frontend/src/assets/i18n/{en,de,fr,es,it,pt}.json`
- `docs/security-model.md`
- `docs/specs/projects.md`
- `docs/i18n.md`

## 1. Overview

The composer model selector currently presents a growing list of models, with pinning and cost
visibility. As the catalogue expands, model names alone are not enough for Account holders to
quickly choose the right model.

This work is about setting sane defaults and making it easy for people to find and use a specific
model when they need one.

This spec improves model discovery in both the compact composer selector and the more verbose model
list in account settings, while preserving Cognos' privacy posture:

- model search, filters, ordering, hiding, recent models, and defaults are resolved in the browser
- no composer/settings model search query is sent to the server
- no plaintext preference payload is stored server-side
- Account holder-synced preferences continue to use the existing encrypted `user_preferences.data`
  blob
- all UI copy is localised across the supported languages

The product shift is from **model-name selection** to **default-first, purpose-aware selection**:

1. Account holders who know nothing get a good model from the start for the current purpose.
2. Account holders who are exploring can quickly understand each model's strengths and what to
   expect.
3. Account holders who know exactly what they want have their models at their fingertips at all
   times.

The primary audience is non-technical and slightly technical Account holders, so the UI should
choose sensible defaults wherever possible rather than forcing Account holders to understand model
catalogues.

The composer implementation should stay compact and mobile-first. The account settings model list
can be more verbose and should act as the main management surface for defaults, hidden models, and
model preference review.

## 2. Target audience

### Account holders who know nothing about models

Account holders who do not know model names and should not need to. This is the primary audience.
They should start with a good model for the current purpose and be able to chat without opening the
selector.

### Account holders who are exploring

Account holders who understand broad trade-offs such as faster, cheaper, more private, better for
reasoning, or able to generate images, but do not want to track provider/model naming. They need
clear, plain-language strengths, rough expectations, and safe recommendations.

### Account holders who know what they want

Account holders who frequently switch between specific models for cost, speed, reasoning, image
generation, privacy region, or quality. They need fast access through pinned models, recent models,
search, keyboard navigation, and defaults. Their controls must not make the default experience
noisier for everyone else.

### Privacy-conscious Account holders

Account holders who choose Cognos because they expect private-by-design behaviour. They need the
model picker to avoid leaking behaviour such as search terms, hidden models, favourite models, or
project-level preferences in plaintext.

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
- `ModelService.selectModel()` also sets the Account holder's default model through encrypted
  preferences.
- `UserPreferencesService` encrypts preferences client-side before storing them in PocketBase.

Cost of not solving this:

- Account holders are asked to understand model differences before they can get value
- Account holders choose suboptimal models because the desired capability is hard to find
- Account holders overuse expensive/powerful models for simple tasks
- Account holders miss privacy-region options such as Switzerland/EU-hosted models
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
- Account holder-specific preferences that sync between devices must live in the existing encrypted
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

Additional requirements for this feature:

- **Synonym dictionaries must be parity-protected.** Per-language search synonyms (§5.2) must not
  drift between locales. Either store them in the i18n JSON so the existing
  `translation-parity.spec.ts` covers them, or add a dedicated synonym-parity test. Add a canary
  block to `translation-parity.spec.ts` for the new model-discovery key namespace, mirroring the
  existing conversation-copy canary.
- **Search must be diacritic- and case-insensitive.** Normalise both the query and indexed strings
  with `String.normalize('NFD')` + combining-mark stripping so a French/Portuguese/German-speaking
  Account holder searching `günstig`, `rápido`, or `raciocínio` matches. This is the
  search-quality-by-language risk in §12.
- **Curated capability metadata is i18n keys, not literals.** The `strengths` and expectation copy
  in §6.2 must resolve through Transloco keys, never ship as English strings in a TS map. Aliases
  used only for matching may stay as per-language data but must be parity-protected as above.
- Filter labels, the search placeholder, the no-result copy, "show hidden matches", the
  "Manage models, defaults & hidden in Settings" footer link, the privacy microcopy ("Searched on
  this device — never sent to a server" and "End-to-end encrypted · keys never leave this device"),
  and every ineligibility/fallback explanation need enumerated keys present in all six locales.
- All six supported languages are LTR; no RTL work is required.

### 4.3 Default-first UX requirements

The product must serve three modes without asking Account holders to choose a mode explicitly:

- **Know nothing:** pick a good eligible model automatically for the current purpose.
- **Exploring:** explain strengths and rough expectations in plain language.
- **Know exactly what they want:** keep pinned, recent, default, and searchable models one action
  away.

Requirements:

- Prefer a good default over asking the Account holder to configure the model picker.
- The default composer state should work for Account holders who do not know any model names.
- Keep advanced controls available but secondary, especially in the composer.
- Recommendations must be explainable in plain language, for example "Good for everyday chat" or
  "Best when you need image generation".
- Model rows should answer: what is this good for, what will it roughly cost, how private/where is
  it processed, and when should I choose it?
- Do not expose raw provider/model complexity unless it helps the Account holder's decision.
- Settings may show more detail, but should still start with recommended/default choices first.
- If the app can infer a safe choice from non-sensitive local state, use it. Examples: active image
  tool → image-capable models; project default exists → use project default; Account holder privacy
  tier → hide or de-emphasise unavailable models.

### 4.4 Accessibility requirements

Full keyboard navigation is an **expansion**, not a preservation. The current selector exposes
`role="listbox"`/`role="option"` semantics but has no arrow-key handling, so this is net-new work
and should be estimated as such.

- The selector must be fully keyboard usable.
- Opening the selector focuses the search input when search is present, **on desktop only**. On
  mobile the search input is not auto-focused (see §4.5) so the list is visible before the on-screen
  keyboard appears.
- Arrow keys move through visible model options; Home/End jump to first/last.
- Enter selects the focused model.
- Escape closes the selector and dismisses the mobile sheet.
- Filter chips expose pressed state with `aria-pressed` or equivalent and are reachable in the tab
  order.
- Hidden/destructive actions are not only exposed on hover and are reachable by keyboard.
- The existing listbox/option semantics must not be broken by nested action buttons; per-row actions
  must have valid keyboard semantics.
- The mobile sheet traps focus while open, locks background scroll, and restores focus to the
  trigger on close.

### 4.5 Mobile presentation requirements

The composer selector must use a **responsive split** that shares one inner content component:

- **Desktop / pointer with space:** the existing CDK overlay dropdown anchored to the trigger.
- **Mobile / narrow breakpoints:** a bottom-sheet (or full-height sheet) rather than a floating
  dropdown. The current dropdown is height-capped at `calc(100vh - 160px)`; once a search input is
  focused on mobile the on-screen keyboard consumes much of the viewport and the dropdown collapses
  to an unusable sliver. A sheet avoids this.

Requirements:

- A single breakpoint decision drives dropdown-vs-sheet; reuse the existing `DeviceService.isMobile`
  signal rather than introducing a new mechanism.
- The mobile sheet is a partial-height bottom sheet with a drag handle: it locks background scroll,
  traps focus, offers an explicit close (X) affordance and drag-to-dismiss.
- The desktop presentation is a popover anchored to the model button, opening upward into available
  space (existing primary CDK position).
- Touch targets (rows, chips, close) are at least 44×44 px.
- Search is not auto-focused on mobile; the list is visible first and the Account holder taps to
  search.
- The same pure filtering/ordering logic feeds both presentations; only the container differs.

**Layout (shared by both presentations).** The scrollable model list is at the **top**; the controls
sit at the **bottom**, in this order: search input → privacy microcopy → filter-chip rail. Putting
search at the bottom keeps it directly above the on-screen keyboard on mobile.

- The list is grouped, in order: **Pinned → Recent → Recommended → remaining** (see §7).
- Each row shows: an icon, the model name with a region badge beside it (e.g. `ON-PREM`,
  `SWISS CLOUD`, `UK CLOUD`), capability pills below the name, and a meta line (see §5.8).
- Filter chips are a horizontally scrollable rail on mobile; on desktop they may wrap to two rows.
  They must never wrap into a tall block that pushes the list off-screen on mobile.
- Privacy microcopy under the search input reassures that search is local — for example
  "Searched on this device — never sent to a server". A composer-footer line such as
  "End-to-end encrypted · keys never leave this device" reinforces the posture. Both are localised.
- A footer link routes to the fuller management surface: "Manage models, defaults & hidden in
  Settings".
- There is no per-row overflow/hide control in the composer; hiding is managed in settings (§5.5).

## 5. Core features

### 5.1 Sane contextual defaults

- **Description:** Select a sensible eligible model by default before the Account holder has to
  think about model choice.
- **User story:** As an Account holder who knows nothing about models, I want Cognos to start with a
  good model for what I am doing so that I can send a message without configuring anything.
- **Priority:** P0
- **Acceptance criteria:**
    - Fresh Account holders get a recommended eligible model without opening the selector.
    - Default resolution prefers purpose and eligibility over catalogue order.
    - The default adapts to non-sensitive local context where available, for example active image
      tool,
    project default, Account holder privacy tier, billing eligibility, and Account holder default.
    - If a default cannot be used because it is hidden, ineligible, or unavailable, fallback is
      silent
    unless the Account holder is already viewing model settings/selector details.
    - The chosen default is explainable in localised plain language when shown, for example "Good
      for
    everyday chat" or "Selected because image generation is on".
    - No prompt text is sent to the server or used by a remote ranking service to choose the
      default.

### 5.2 Client-side fuzzy search

- **Description:** Add a search input to the model selector. Search runs entirely in the browser
  over the loaded model catalogue and local metadata.
- **User story:** As an Account holder, I want to search by model name, provider, capability,
  privacy region, or synonym so that I can find the right model without scanning the full list.
- **Priority:** P0
- **Acceptance criteria:**
    - Search matches `Model.name`, `Model.providerName`, `Model.description`,
      `Model.hostingCountry`,
    `Model.hostingRegion`, tags, cost tier, and derived capability labels.
    - Search handles common synonyms, for example `cheap` → low cost, `vision` → image,
    `smart`/`quality` → powerful, `private` → privacy-region tags.
    - Search and synonyms are localised per language and matched diacritic- and case-insensitively
    using `NFD` normalisation with combining-mark stripping.
    - Search is computed client-side and does not call an API.
    - Search terms are not persisted and not logged.
    - Empty search shows the default ordered model list.
    - No-result state is localised and suggests clearing filters/search.

### 5.3 Quick capability filters

- **Description:** Add filter chips above the model list for common intents.
- **User story:** As an Account holder, I want one-click filters like Fast, Low cost, Reasoning,
  Image, and Long context so that I can narrow the list by task.
- **Priority:** P0
- **Acceptance criteria:**
    - Initial chips: Recommended, Fast, Powerful, Low cost, Reasoning, Image, Long context.
    - Recommended is selected by default unless the Account holder has an active search/filter,
      pinned/default
    model, or required composer capability that should take precedence.
    - Add a privacy chip such as Switzerland or Private only if the catalogue metadata supports it
    clearly and consistently.
    - Filters are derived from public model metadata already present in `Model` or from a small
    frontend mapping keyed by model ID.
    - The Image filter reuses the existing `supportsImageGeneration` capability.
    - The Reasoning filter uses `reasoningEfforts.length > 0` unless a more explicit backend flag is
    added.
    - Low cost uses `deriveModelCostTier(model.pricing) === 'low'`.
    - Long context uses a documented threshold, `inputContextLength >= 300000`, so the label marks
    genuinely large windows rather than the now-common 128k baseline.
    - Fast, Powerful, and Recommended require explicit local metadata rather than guessing from
      name.
    - Filter labels use plain-language outcomes, not provider jargon.

### 5.4 Pinned, recent, and selected ordering

- **Description:** Preserve existing pinning and add recents so frequently used models are easier to
  reach without configuration.
- **User story:** As an Account holder who frequently switches models, I want my pinned and recently
  used models near the top so that I can switch quickly.
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
    - Recent model IDs are stored in encrypted preferences (§6.3); local-only browser storage is
    rejected (§6.4).

### 5.5 Hidden models

- **Description:** Let Account holders hide models they never want to see in the normal selector.
- **User story:** As an Account holder, I want to hide irrelevant models so that the picker stays
  focused on my choices.
- **Priority:** P1
- **Acceptance criteria:**
    - Hiding is managed **only in account settings**; the composer has no per-row hide/overflow
    control. The composer footer links to the settings management surface.
    - Account settings exposes Hide and Unhide per model and a "reset all hidden models" action.
    - Hidden models are removed from the composer's normal list, filters, and default ordering.
    - If the selected/default model becomes hidden, selection falls back to the next eligible
      visible
    model.
    - Composer search no-result state can offer "show hidden matches" when hidden models match the
    query, so a hidden model is still reachable without leaving the composer.
    - Hidden IDs are not stored in plaintext on the server.

### 5.6 User default model

- **Description:** Keep default-model behaviour **implicit**: selecting a model is what makes it the
  Account holder's default. There is no separate "Set as my default" action. Account holders still
  get a sane default even if they have never actively chosen one.

> **Extended by [tool-aware-model-selection.md](./tool-aware-model-selection.md):** the implicit
> default is being made **per capability context** (one for chat, one for image generation, …), so
> toggling a composer tool restores the right model. Plain-chat behaviour and `defaultModelId` are
> unchanged; the tool contexts add `toolModelDefaults`.
- **User story:** As an Account holder, I want the model I pick to stick as my default for new chats
  without managing a separate default setting.
- **Priority:** P1
- **Acceptance criteria:**
    - Selecting a model persists it as the Account holder default. This preserves current behaviour:
    `selectModel()` writes `defaultModelId`. No explicit "Set as my default" control is added in the
    composer or settings.
    - Because the default is implicit, it _is_ the currently selected model. It needs no separate
    "DEFAULT" chip or extra highlight; the existing selected state (check icon / active row) conveys
    it in both the composer selector and the account settings model list.
    - `ModelService.selectedModel` fallback order becomes:
    encrypted project default (in a project and eligible) → encrypted Account holder default →
    recommended eligible model → first eligible visible model.
    - Selecting a model also marks it recent (§5.4); recency does not change the default beyond the
    selection itself.
    - Default model ID remains in encrypted `user_preferences.data` through `defaultModelId`.
    - No plaintext account field is added for model defaults.

### 5.7 Project default model

- **Description:** Allow a project to define a default model for conversations created in that
  project, without revealing the choice in plaintext.
- **User story:** As a Participant, I want a project-specific default model so that project chats
  use the model appropriate for that workspace.
- **Priority:** P2
- **Encryption design (no new key to import):** Projects already have a **project content key** — a
  32-byte symmetric key (`crypto.randomKey()`) generated at project creation, sealed to each
  member's public key, and stored in `project_key_wrappings`
  (`frontend/src/app/services/project.service.ts`,
  `backend/db/migrations/1760000040_created_projects_collections.go`). The project metadata blob
  (`projects.data`) is already `secretBox`-encrypted under that key and decryptable by every member.
  The project default model rides that existing blob; there is no separate key to import or
  provision and no new collection/migration.
- **Acceptance criteria:**
    - Add `defaultModelId` (and optionally `defaultPersonaId`) to the encrypted `ProjectData` schema
    (`frontend/src/app/interfaces/project.ts`). It is never a plaintext project field.
    - The value is written through the existing `ProjectService.updateProject()` re-encrypt pipeline
    and read by decrypting `projects.data`; no new collection, migration, or API surface is added.
    - Project default is set **explicitly** in project settings — a shared workspace choice,
      distinct
    from the implicit personal default in §5.6. Because it lives under the shared project content
    key, every member resolves the same project default.
    - Resolution order is documented and tested:
    1. model selected for this chat/session
    2. encrypted project default, when in a project and eligible
    3. encrypted Account holder default, when eligible
    4. recommended eligible model
    5. first eligible visible model
    - If the project default is not eligible for the Account holder's privacy tier or billing state,
      the UI
    shows a localised fallback explanation.
    - Stale-safe: an unknown or ineligible project `defaultModelId` is ignored and resolution falls
    through to the next source.
    - Existing project encryption principles in `docs/specs/projects.md` are preserved.

> **Redaction is a separate gap, not a blocker here.** Redaction secrets are currently wrapped
> per-user (`conversation_redaction_keys`) with no project-content-key wrapping, which blocks
> _redaction inside project conversations_ and project conversation copy. That does **not** affect
> the project default model, which only stores a model ID in already-encrypted project metadata.
> Project-scoped redaction — a `project_redaction_keys` collection wrapping the redaction secret
> under the project content key, mirroring `project_conversation_keys` — is tracked separately and
> out of scope for this spec.

### 5.8 Model strengths and expectations

- **Description:** Make capabilities, strengths, and rough expectations scannable without relying on
  long descriptions.
- **User story:** As an Account holder who is exploring models, I want to understand what each model
  is good for and what trade-offs to expect so that I can choose confidently.
- **Priority:** P1
- **Acceptance criteria:**
    - **Cost is shown via the existing cost lozenge only; there is no plain-language cost tier word
in the meta line.** The lozenge keeps its current behaviour: shown for metered plans, hidden for
unlimited plans. (Unlimited-plan Account holders therefore see no cost signal, which is acceptable.)
    - Row anatomy: icon, model name with a region badge beside it
      (`ON-PREM`/`SWISS CLOUD`/`UK CLOUD`
    etc.), capability pills below the name, and a meta line of `context size · city · region-type`
    (no cost word).
    - Capability pills use localised copy and existing `TagComponent`/`CognosLozengeComponent`
    patterns; concise labels such as Everyday, Fast, Reasoning, Image, Long context, Low cost, or
    Private/Swiss/EU where supported.
    - Rows communicate rough expectations without precise benchmarking claims — context size,
      privacy
    region, and whether the model suits simple or demanding tasks — via pills and the meta line.
    - Descriptions remain available but do not dominate the row.
    - Ineligible models keep showing their localised ineligibility reason when available.

### 5.9 Account settings model management

- **Description:** Reflect the same discovery and preference behaviour in the account settings model
  list, using the extra space there for more explanatory controls.
- **User story:** As an Account holder, I want to manage model preferences in settings so that the
  compact composer stays quick while settings gives me a fuller overview.
- **Priority:** P1
- **Acceptance criteria:**
    - The account settings model list supports the same search and quick filters as the composer.
    - Settings shows the same pinned, hidden, recent, default, capability, cost, privacy-region, and
    eligibility state as the composer.
    - Settings provides clearer actions for Pin/Unpin, Hide/Unhide, and Reset hidden models. There
      is
    no "Set as my default" action; the default is implicit per §5.6 and only labelled here.
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
- **User story:** As a non-technical Account holder, I want Cognos to pick a sensible model so that
  I do not need to understand the catalogue.
- **Priority:** P2 / future
- **Acceptance criteria:**
    - Auto mode is opt-in or clearly labelled.
    - Auto mode should be considered if repeated usability testing shows Account holders still
      hesitate at model
    choice even after search, filters, and recommended defaults.
    - First version uses only local rules: active composer tool, attachments, selected filters,
    privacy tier, billing eligibility, project default, and Account holder preference.
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
- `strengths` and expectation copy must be Transloco **keys**, not literal strings, and resolve
  through i18n; they are parity-protected (§4.2)
- `aliases` are match-only per-language data, never rendered, and must also be parity-protected
- the curated `recommended`/`fast`/`powerful` set and the first recommended default per privacy
  tier are product-owned values maintained here and reviewed whenever the catalogue changes

If this mapping grows too large or needs backend ownership, expose it as public catalogue metadata
in `/api/v1/models`; it must remain product metadata, not Account holder-specific data.

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
toolModelDefaults: Record<string, string>   // per-capability-context default; see tool-aware-model-selection.md §5
```

Rules:

- These fields belong in `UserPreferencesData` and therefore in encrypted `user_preferences.data`.
- Defaults must be backward compatible in Zod, as existing preferences will not contain these keys.
- IDs should be treated as stale-safe: unknown model IDs are ignored at read time.
- Recent and hidden model lists should not expose model preference data in plaintext server fields.

### 6.4 Rejected: local-only browser storage

A local-only `localStorage` MVP for `recentModels`/`hiddenModels` was considered and **rejected**.
`recentModels` is behavioural metadata — which models an Account holder actually uses — and
`localStorage` under a key such as `cognos:model-selector:<user-id>` persists across logout and is
readable by any script on the origin or by anyone on a shared machine. These fields must use
encrypted sync via `UserPreferencesService` (§6.3) instead, inheriting the existing NaCl secretbox
protection.

If any non-syncing, UI-only state ever needs browser storage, it must store only non-sensitive UI
state (never model usage history, key material, or message content) and be cleared on logout.

### 6.5 Project default (encrypted project metadata)

The project default model (§5.7) is **not** a new key or collection. It is an additional field in
the existing encrypted project metadata blob:

```txt
ProjectData (encrypted in projects.data under the project content key)
  version
  name
  description
  icon
  color
  instructions
  defaultModelId      ← new, optional
  defaultPersonaId    ← new, optional
```

Rules:

- The project content key already exists: generated at project creation (`crypto.randomKey()`),
  sealed to each member's public key, stored in `project_key_wrappings`. No import or provisioning
  step is introduced by this feature.
- `defaultModelId`/`defaultPersonaId` are written via the existing `ProjectService.updateProject()`
  re-encrypt pipeline and read by decrypting `projects.data`. No plaintext project field is added.
- Zod defaults must be backward compatible: existing projects have no such keys and default to `''`.
- Stale-safe: unknown/ineligible IDs are ignored at read time and resolution falls through (§5.7).
- This is distinct from the per-Account-holder encrypted `defaultModelId` in §6.3; project defaults
  are shared among all Participants under the project content key.

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
   a. pinned models, in Account holder pin order
   b. recent models, most-recent first
   c. recommended models
   d. remaining models in catalogue order
8. If no explicit/default model is available, preselect the first recommended eligible model before
   falling back to the first eligible visible model
```

The currently selected model is **not** hoisted to the top. It stays in its natural group (pinned,
recent, recommended, or remaining) and is marked with the existing selected state (check icon /
active row). Since the default is implicit, the selected model _is_ the default — no separate
position or label is needed.

Pinned order should continue to be frozen when the dropdown opens to avoid row jumps.

## 8. Non-functional requirements

- **Performance:** filtering and search should update within 50 ms for a catalogue of 500 models on
  a mid-range laptop. The selector should not block typing in the composer.
- **Security:** search terms, hidden models, recent models, pinned models, defaults, and project
  defaults must not be stored in plaintext on the server. No plaintext chat content is introduced by
  this feature. Filter-chip and model-row interactions must not emit analytics/telemetry events
  carrying model IDs alongside an Account holder identifier.
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
| Time to first useful chat                          | Fresh Account holders can send their first message without opening the model selector                                                  | Usability script / Playwright happy path                             |
| Model selection time in usability script           | Median under 10 seconds for "find an image/reasoning/low-cost model" tasks with non-/slightly-technical Account holders                | Manual UX script or Playwright-assisted timing in a seeded catalogue |
| Zero server calls during search/filter interaction | 0 API requests after catalogue load while typing/filtering                                                                             | Playwright network assertions                                        |
| Translation coverage                               | 100% key parity across `en/de/fr/es/it/pt`                                                                                             | `translation-parity.spec.ts`                                         |
| Preference plaintext leakage                       | 0 new plaintext Account holder/project fields for recents, hidden models, or defaults                                                  | Code review + API e2e assertions                                     |
| Keyboard completion                                | User can open selector, search, move, select, and close without mouse                                                                  | Playwright e2e                                                       |
| Default acceptance                                 | At least 70% of test Account holders can start a chat without changing model and describe the default as reasonable                    | Usability script / product review                                    |
| Exploration comprehension                          | At least 80% of test Account holders can identify which model is better for image, reasoning, low-cost, and private use cases          | Usability script / product review                                    |

## 10. Testing requirements

Follow the project preference for high-level e2e tests first, then unit tests for pure logic.

### 10.1 Browser e2e tests

Add or extend tests under `frontend/e2e/`:

- `models.spec.ts` or new `model-selector-discovery.spec.ts`
- account settings model-list coverage in `account-*` or a dedicated `account-models.spec.ts`
- fresh Account holder can start a chat with the recommended default without opening the model
  selector
- search by model name
- search by provider
- search by capability synonym
- filter by image and verify non-image models are hidden
- filter by reasoning and verify only models with reasoning efforts appear
- model rows expose strengths/expectations clearly enough to distinguish common use cases
- hide a model and verify it disappears from the normal list
- show/manage hidden models and unhide
- select a model in the composer and verify it becomes the implicit default, restored after
  reload/unlock
- verify the current default is labelled in both the composer selector and account settings
- hide/unhide models in account settings and verify the composer reflects it
- verify the responsive split: bottom-sheet on mobile widths, dropdown on desktop
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
- contextual default resolution for fresh Account holders, image mode, project default, Account
  holder default, hidden, and ineligible models
- capability filter predicates
- ordering pipeline with selected, pinned, recent, recommended, hidden, and ineligible models
- default resolution prefers recommended eligible models before generic first eligible fallback
- Zod defaults for new preference fields
- recent model de-duplication and cap
- hidden model fallback when default/selected is hidden
- i18n translation parity

## 11. Implementation milestones

| Phase                                             | Duration  | Deliverables                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 1: Search, filters, defaults, a11y & mobile | 1-2 weeks | Client-side search (diacritic/case-insensitive) + filter chips in composer and settings, shared pure filtering/order logic + tests, recommended default fallback, **full keyboard navigation (net-new)**, **responsive dropdown/bottom-sheet split (§4.5)**, i18n keys + synonym parity, Playwright coverage |
| Phase 2: Recents and hidden models                | 1 week    | `recentModels`, `hiddenModels` in encrypted preferences (schema defaults), composer hide action via overflow, settings hide/unhide management, tests                                                                                                                                                         |
| Phase 3: Default labelling & resolution           | 0.5 week  | Implicit-default labels in composer/settings, project-aware resolution order, fallback tests, encrypted preference assertions (no explicit "set default" UI)                                                                                                                                                 |
| Phase 4: Project defaults                         | 1 week    | Add `defaultModelId` to the encrypted `ProjectData` blob (rides the existing project content key — no new collection/migration), project-aware resolution order, project settings UI, access/encryption tests                                                                                                |
| Phase 5: Auto mode                                | later     | local-rule Auto option with transparent explanation and privacy review                                                                                                                                                                                                                                       |

## 12. Risks and mitigations

| Risk                                                                                                  | Impact | Likelihood | Mitigation                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The selector becomes visually overloaded with search, chips, pins, and badges                         | High   | Medium     | Keep the composer compact; move hide management entirely to settings (§5.5); no per-row overflow; use the responsive bottom-sheet on mobile (§4.5); test on mobile widths     |
| Capability labels are misleading because `fast` and `powerful` are subjective                         | Medium | High       | Use explicit curated metadata; do not infer from names or cost; review labels when catalogue changes                                                                          |
| Sane defaults are wrong for some Account holders                                                      | Medium | Medium     | Make defaults easy to override, keep recommendations explainable, and prefer privacy/billing eligibility constraints before capability ranking                                |
| Preference changes accidentally add plaintext server fields                                           | High   | Low        | Store synced preferences only in encrypted `user_preferences.data`; add API/code-review checks                                                                                |
| Nested row actions break listbox accessibility                                                        | Medium | Medium     | Revisit markup so row selection and per-row actions have valid keyboard semantics; cover with tests                                                                           |
| Search quality varies by language                                                                     | Medium | Medium     | Start with stable metadata plus translated synonyms; normalise diacritics/case (`NFD`); use i18n parity tests; avoid relying only on English descriptions                     |
| Hidden default model creates confusing fallback behaviour                                             | Medium | Medium     | Show localised fallback copy and provide a clear reset/unhide path                                                                                                            |
| Project default model leaks the choice in plaintext                                                   | Medium | Low        | Store it inside the already-encrypted `projects.data` blob under the existing project content key; never add a plaintext project field; assert opacity in API e2e             |
| Redaction inside project conversations is wrongly assumed available (separate gap)                    | Medium | Medium     | Out of scope here: project default models only store a model ID in encrypted metadata; project-scoped redaction keys (`project_redaction_keys`) are tracked separately (§5.7) |

## 13. Non-goals

- Server-side personalised recommendations.
- Server-side search endpoints for model picker queries.
- Sending prompt text to a ranking service.
- Logging model search terms or filter usage with Account holder identifiers.
- Reworking the backend provider catalogue beyond optional public metadata additions.
- Building a full model comparison page.
