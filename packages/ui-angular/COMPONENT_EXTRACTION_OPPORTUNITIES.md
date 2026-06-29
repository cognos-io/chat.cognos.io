# Angular UI component extraction opportunities

Scope: `frontend/src/app` compared against the current `@cognos/ui-angular` library. Candidates
below are limited to UI patterns seen in more than two places, so this intentionally avoids one-off
extraction.

## Status

- ✅ **`cog-card`** — done. Adopted by account, MFA, memory, placeholder; danger tone.
- ✅ **`cog-list` / `cog-list-item`** — done. Adopted by MFA trusted devices + the data-processing
  model catalogue list.
- ✅ **`cog-empty-state`** — done. Adopted by the file library and the model catalogue empty result.
- ✅ **`cog-search-field`** — done. Adopted by the file library and the model catalogue search.
- ✅ **`cog-page-header`** — done. Backs `app-settings-page`.
- ✅ **`cog-auth-page`** — done. Adopted by all six auth pages (login, register, forgot/reset
  password, verify/confirm email); each dropped its duplicated layout CSS.
- ⬜ Remaining below (`cog-field`, `cog-choice-chip-group`, `cog-choice-card-group`,
  `cog-avatar-picker`, `cog-record-list`) — not started. Further adoption of the shipped primitives
  across the other listed sites is also outstanding.

## `cog-card` / section card

**Recommendation:** use the existing `CognosCardComponent` rather than creating another component.
It already matches the repeated bordered surface + heading/subtitle + actions-row pattern. The
frontend still has local copies (`app-settings-card`, `account__card`, `security__card`, `pb__card`,
etc.) that can be migrated.

**Should do:** provide standard section chrome, optional title/subtitle, optional heading actions,
bottom actions slot, and danger tone.

**Possible future uses:**

- `frontend/src/app/components/settings/settings-card.component.ts`
- `frontend/src/app/pages/account/account.component.ts`
- `frontend/src/app/pages/account/mfa-settings.component.ts`
- `frontend/src/app/components/account/data-processing/data-processing.component.ts`
- `frontend/src/app/pages/projects/projects-page.component.html`
- `frontend/src/app/pages/projects/project-detail.component.html`
- `frontend/src/app/pages/account/billing/plan-billing.component.html`
- `frontend/src/app/pages/pricing/pricing.component.ts`

## `cog-auth-page` / auth panel

**Recommendation:** create a new auth layout component, or a very small `cog-auth-card` primitive if
the full-page background should stay app-owned.

**Should do:** render the centred auth surface with the Cognos logo slot, title, lead copy,
form/content slot, legal/switch-link slot, responsive mobile full-height layout, and consistent
loading-copy layout inside submit buttons.

**Existing overlap:** `cog-card` covers the inner surface only; it does not cover the auth-page
background, logo placement, mobile layout, or repeated auth typography.

**Possible future uses:**

- `frontend/src/app/pages/auth/login/login.component.ts`
- `frontend/src/app/pages/auth/register/register.component.ts`
- `frontend/src/app/pages/auth/forgot-password/forgot-password.component.ts`
- `frontend/src/app/pages/auth/reset-password/reset-password.component.ts`
- `frontend/src/app/pages/auth/verify-email/verify-email.component.ts`
- `frontend/src/app/pages/auth/confirm-email-change/confirm-email-change.component.ts`

## `cog-field` / labelled form field

**Recommendation:** add a wrapper component around existing inputs rather than duplicating label,
hint, error, and spacing rules. This could pair with `cog-text-field` and future `cog-textarea` /
`cog-select` controls.

**Should do:** render label, projected control, optional hint/error text, disabled/read-only state
styling, and consistent vertical spacing. Keep actual form control ownership with Angular
forms/template bindings.

**Existing overlap:** `cog-text-field` provides a styled single-line input, but not labels, errors,
hints, textarea/select variants, or form-field layout.

**Possible future uses:**

- `frontend/src/app/pages/auth/login/login.component.ts`
- `frontend/src/app/pages/auth/register/register.component.ts`
- `frontend/src/app/pages/auth/forgot-password/forgot-password.component.ts`
- `frontend/src/app/pages/auth/reset-password/reset-password.component.ts`
- `frontend/src/app/components/edit-conversation-dialog/edit-conversation-dialog.component.ts`
- `frontend/src/app/pages/account/mfa-settings.component.ts`
- `frontend/src/app/components/projects/project-settings-dialog/project-settings-dialog.component.ts`
- `frontend/src/app/pages/projects/projects-page.component.html`
- `frontend/src/app/components/personas/persona-editor/persona-editor.component.html`
- `frontend/src/app/components/vault-password-dialog/vault-password-dialog.component.ts`

## `cog-search-field`

**Recommendation:** create a small search-specific field, or extend `cog-text-field` with
first-class `type="search"`, icon, clear button, and full-width sizing.

**Should do:** show a search icon, render a 44px accessible search input, emit query changes,
optionally include a clear affordance, and keep focus styling consistent.

**Existing overlap:** `cog-text-field` has icon support, but current search fields are mostly
hand-written and use slightly different borders/radii/backgrounds.

**Possible future uses:**

- `frontend/src/app/pages/account/account-library.component.ts`
- `frontend/src/app/attachments/library-picker/library-picker-dialog.component.ts`
- `frontend/src/app/pages/personas/personas-page.component.html`
- `frontend/src/app/components/chat/message-form/model-selector/model-selector.component.ts`
- `frontend/src/app/components/account/data-processing/data-processing.component.ts`

## `cog-choice-chip-group` / generic selectable chips

**Recommendation:** extract a generic chip group. The existing `cog-filter-chips` is vault-specific
and has hard-coded options, so it is not reusable for model filters, personas, billing intervals, or
view toggles.

**Should do:** render a horizontal/wrapping group of options, support single selection, emit
selected value, expose `aria-label`, and allow optional leading/trailing icons or badges.

**Existing overlap:** `cog-lozenge` is display-only; `cog-filter-chips` is interactive but
domain-specific.

**Possible future uses:**

- `frontend/src/app/components/chat/message-form/model-selector/model-selector.component.ts`
- `frontend/src/app/components/account/data-processing/data-processing.component.ts`
- `frontend/src/app/components/chat/message-form/persona-chips/persona-chips.component.ts`
- `frontend/src/app/pages/pricing/pricing.component.ts`
- `frontend/src/app/components/billing/switch-plan-modal/switch-plan-modal.component.html`
- `frontend/src/app/pages/personas/personas-page.component.html`

## `cog-choice-card-group` / selectable option cards

**Recommendation:** create a card/tile selection primitive for radio-like choices that need more
content than a chip.

**Should do:** render selectable cards/buttons with active, disabled, and hover states; support
title, description, icon, badge/meta, and either button-based or native-radio semantics depending on
usage.

**Existing overlap:** `cog-card` is static chrome; `cog-choice-chip-group` would be too small for
multi-line choices.

**Possible future uses:**

- `frontend/src/app/components/account/data-processing/data-processing.component.ts`
- `frontend/src/app/components/chat/temporary-message-dialog/temporary-message-dialog.component.ts`
- `frontend/src/app/components/edit-conversation-dialog/edit-conversation-dialog.component.ts`
- `frontend/src/app/components/share-conversation-dialog/share-conversation-dialog.component.ts`
- `frontend/src/app/components/billing/switch-plan-modal/switch-plan-modal.component.html`
- `frontend/src/app/pages/pricing/pricing.component.ts`

## `cog-avatar-picker`

**Recommendation:** extract the icon + colour picker pattern into a generic primitive that accepts
icon and colour options. Keep persona/project/account domain persistence outside the component.

**Should do:** show current avatar preview, icon radiogroup, colour radiogroup, selected states,
accessible labels, keyboard/focus styling, and emit selected icon/colour.

**Existing overlap:** `cog-avatar` renders the avatar but does not provide the picker UI.

**Possible future uses:**

- `frontend/src/app/pages/account/account.component.ts`
- `frontend/src/app/components/personas/persona-editor/persona-editor.component.html`
- `frontend/src/app/components/projects/project-settings-dialog/project-settings-dialog.component.ts`

## `cog-page-header`

**Recommendation:** extract a page-header primitive for breadcrumb + title + subtitle + actions.
Keep route-specific breadcrumb construction in the host.

**Should do:** render optional breadcrumbs, title, subtitle, optional leading visual/avatar, and
trailing actions with consistent spacing/responsive behaviour.

**Existing overlap:** `cog-breadcrumbs` handles only breadcrumbs; `app-settings-page` is
settings-specific and not reusable for projects, personas, billing, or chat header surfaces.

**Possible future uses:**

- `frontend/src/app/components/settings/settings-page.component.ts`
- `frontend/src/app/pages/projects/projects-page.component.html`
- `frontend/src/app/pages/projects/project-detail.component.html`
- `frontend/src/app/pages/personas/personas-page.component.html`
- `frontend/src/app/pages/account/billing/plan-billing.component.html`
- `frontend/src/app/components/chat/chat-header/chat-header.component.html`

## `cog-empty-state`

**Recommendation:** create a low-friction empty state component for repeated centred muted messages,
with optional icon, title, body, and actions.

**Should do:** provide consistent spacing, muted typography, optional icon/illustration, optional
action slot, and role/status support where needed.

**Existing overlap:** `cog-section-message` is closer to a callout/banner. Most empty states are
currently just styled paragraphs or small empty blocks.

**Possible future uses:**

- `frontend/src/app/pages/account/account-library.component.ts`
- `frontend/src/app/attachments/library-picker/library-picker-dialog.component.ts`
- `frontend/src/app/components/chat/message-form/model-selector/model-selector.component.ts`
- `frontend/src/app/components/account/data-processing/data-processing.component.ts`
- `frontend/src/app/pages/personas/personas-page.component.html`
- `frontend/src/app/pages/projects/projects-page.component.html`
- `frontend/src/app/pages/projects/project-detail.component.html`
- `frontend/src/app/components/chat/message-list/message-list.component.ts`
- `frontend/src/app/components/chat/conversation-memory/conversation-memory.component.html`

## `cog-record-list` / richer list row

**Recommendation:** extend the existing `cog-list` / `cog-list-item` pattern before creating a
separate component. Current list rows often repeat leading icon/avatar, primary text, secondary
meta, trailing badges/actions, hover states, and dividers.

**Should do:** standardise list row layout with leading visual, title, description/meta, trailing
area, optional selected/disabled state, and link/button variants.

**Existing overlap:** `cog-list` and `cog-list-item` exist, but are currently minimal and only used
once in the frontend.

**Possible future uses:**

- `frontend/src/app/pages/account/account-library.component.ts`
- `frontend/src/app/attachments/library-picker/library-picker-dialog.component.ts`
- `frontend/src/app/components/account/data-processing/data-processing.component.ts`
- `frontend/src/app/components/chat/message-form/model-selector/model-selector.component.ts`
- `frontend/src/app/pages/projects/projects-page.component.html`
- `frontend/src/app/pages/projects/project-detail.component.html`
- `frontend/src/app/pages/account/mfa-settings.component.ts`
- `frontend/src/app/pages/account/billing/plan-billing.component.html`

## `cog-attachment-chip` / file attachment display

**Recommendation:** migrate app-specific file chips/rows to the existing file components before
adding new ones. The package already has `cog-file-badge`, `cog-attach-chip`, `cog-doc-attachment`,
and `cog-upload-row`.

**Should do:** consistently show file type, name, size/status, encrypted state, remove/open actions,
and progress/error states.

**Existing overlap:** strong overlap already exists in `packages/ui-angular/src/lib/files/*`; the
opportunity is mostly adoption and possibly minor API additions for library-specific rows.

**Possible future uses:**

- `frontend/src/app/components/chat/message-form/message-form.component.ts`
- `frontend/src/app/components/chat/message-attachment-chip/message-attachment-chip.component.ts`
- `frontend/src/app/pages/account/account-library.component.ts`
- `frontend/src/app/attachments/library-picker/library-picker-dialog.component.ts`
- `frontend/src/app/components/chat/message-list-item/message-list-item.component.ts`
