# `@cognos/ui-angular` components

Agent entry point: **before building any frontend UI, check here for an existing component.**
Reach for these instead of hand-rolling markup/CSS so the app stays visually consistent. All are
standalone, imported from `@cognos/ui-angular`, and use design tokens from `@cognos/ui` (see
`styles/tokens.css` + `DESIGN_SYSTEM.md`) — never hardcode colours/radii. Each component has a
`.stories.ts` (Storybook) and a `.component.spec.ts` next to it.

When something is used in **more than two** places and no component fits, extract a new one here
(component + story + spec + `public-api.ts` export) rather than copying. See
`COMPONENT_EXTRACTION_OPPORTUNITIES.md` for the running backlog.

## Layout & structure

| Selector                                 | When to use                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cog-page-header`                        | Top of a page: breadcrumbs + title + optional subtitle + trailing actions slot.                                                                                           |
| `cog-card`                               | A settings/section card: bordered surface, heading/subtitle, `[card-heading-actions]` + `[card-actions]` slots, `tone="danger"` for destructive sections.                 |
| `cog-list` / `cog-list-item`             | A borderless, hairline-divided vertical list of records (devices, models, members). Item is a flex row (content left, actions right).                                     |
| `cog-empty-state`                        | The centred, muted "nothing here" block for empty lists/searches (optional icon/title/message + actions slot).                                                            |
| `cog-auth-page`                          | Shared layout for unauthenticated pages (login, register, password/email flows): gradient background, centred card, and `auth-page__*` typography for the projected form. |
| `cog-desktop-shell` / `cog-mobile-shell` | App frame (sidebar/nav + content) for desktop / mobile.                                                                                                                   |

## Inputs & primitives

| Selector                          | When to use                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `cog-button`                      | Any button. `appearance`: primary / default / danger / subtle.                                                                                |
| `cog-icon-button`                 | An icon-only button.                                                                                                                          |
| `cog-text-field`                  | A styled single-line input — `[value]`/`(valueChange)` or `formControlName` (it's a ControlValueAccessor); `size="lg"` for auth-style fields. |
| `cog-field`                       | A labelled form-field wrapper (label + projected control + optional hint/error). Pairs with `cog-text-field`.                                 |
| `cog-search-field`                | A search input (leading magnifier, 44px, `valueChange`) for list/catalogue filters.                                                           |
| `cog-choice-chip-group`           | A horizontal single-select pill group (model filters, billing interval, toggles). `allowDeselect` clears on re-click.                         |
| `cog-toggle`                      | A boolean on/off switch.                                                                                                                      |
| `cog-icon`                        | Render a named icon (`@cognos/ui/icons`).                                                                                                     |
| `cog-lozenge`                     | A small status/label badge (tones: neutral/blue/green/purple/red).                                                                            |
| `cog-callout`                     | A tinted note/warning box with optional leading icon (tones: neutral/info/success/warning/danger). Projects rich text (supports `<strong>`).  |
| `cog-avatar` / `cog-avatar-group` | A user/entity avatar (initials/icon/colour) / stacked avatars.                                                                                |
| `cog-avatar-picker`               | Pick an avatar icon + colour. Colour swatches are live `cog-avatar` previews (palette comes from `cog-avatar`, no hardcoded colours).         |

## Navigation & overlays

| Selector                           | When to use                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cog-breadcrumbs`                  | Breadcrumb trail (usually via `cog-page-header`).                                                                                                                                    |
| `cog-nav-item`                     | A sidebar/nav row.                                                                                                                                                                   |
| `cog-drawer`                       | A slide-in panel.                                                                                                                                                                    |
| `cog-menu`                         | A dropdown/popover menu.                                                                                                                                                             |
| `cog-sheet`                        | A bottom sheet (mobile-style).                                                                                                                                                       |
| `cog-modal` / `cog-dialog-surface` | A centred dialog / the reusable dialog surface chrome.                                                                                                                               |
| `cog-dialog-actions`               | The footer action row for any dialog surface — projects buttons, handles gap/alignment (`align`) + mobile layout (`mobile`). Put it in the footer slot instead of a bespoke `<div>`. |
| `cog-security-modal`               | A security-sensitive confirmation modal.                                                                                                                                             |
| `cog-toast-host`                   | App toast outlet (use `CognosToastService.notify(...)` to raise toasts).                                                                                                             |

## Files & images

| Selector                                                                  | When to use                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `cog-file-badge`                                                          | File-type badge/icon.                                               |
| `cog-attach-chip`                                                         | A compact file attachment chip.                                     |
| `cog-doc-attachment`                                                      | A document attachment row/card.                                     |
| `cog-upload-row`                                                          | An in-progress upload row.                                          |
| `cog-dropzone`                                                            | A drag-and-drop upload target.                                      |
| `cog-progress`                                                            | A progress bar/indicator.                                           |
| `cog-audio-note`                                                          | An audio note player.                                               |
| `cog-image-thumb` / `cog-image-grid` / `cog-lightbox` / `cog-model-image` | Image thumbnail / grid / fullscreen viewer / generated-model image. |

## Chat & conversation

| Selector                                                             | When to use                                               |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| `cog-user-message` / `cog-assistant-message` / `cog-section-message` | Chat message bubbles (user / assistant / system-section). |
| `cog-composer`                                                       | The chat message composer.                                |
| `cog-branch-switcher`                                                | Switch between message-tree branches.                     |
| `cog-redacted-text`                                                  | Render text with redaction pills.                         |
| `cog-code-block`                                                     | A syntax-highlighted code block.                          |
| `cog-source-card` / `cog-sources-row`                                | Citation source card / row.                               |
| `cog-vault-ref-chip`                                                 | A reference chip to a vault item.                         |

## Vault

These "vault" file-browsing surfaces are reused by the app's **File library** page
(`account-library.component.ts`). Their visible strings default to English but can be
overridden for i18n: `cog-filter-chips` takes a translated `options` array,
`cog-vault-card`/`cog-vault-list-row` take `moreLabel` (the ⋯ action's accessible label)
and `refsText` (footer reference text; pass `''` to hide it until a count is known). Set
`refsInteractive` to render that reference line as a button that emits `refsClick` (e.g.
to open the list of chats that reference the file).

| Selector                                                                        | When to use                                                      |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `cog-vault-page` / `cog-vault-card` / `cog-vault-list-row` / `cog-vault-picker` | File-browsing surfaces (grid card, list row, full page, picker). |
| `cog-storage-meter`                                                             | Storage-usage meter.                                             |
| `cog-filter-chips`                                                              | File-kind filter chips (pass translated `options` for i18n).     |
| `cog-confirm-shred`                                                             | Destructive "shred" confirmation.                                |
