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

| Selector                          | When to use                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `cog-button`                      | Any button. `appearance`: primary / default / danger / subtle.                                                        |
| `cog-icon-button`                 | An icon-only button.                                                                                                  |
| `cog-text-field`                  | A styled single-line input (value/valueChange; optional leading icon).                                                |
| `cog-search-field`                | A search input (leading magnifier, 44px, `valueChange`) for list/catalogue filters.                                   |
| `cog-choice-chip-group`           | A horizontal single-select pill group (model filters, billing interval, toggles). `allowDeselect` clears on re-click. |
| `cog-toggle`                      | A boolean on/off switch.                                                                                              |
| `cog-icon`                        | Render a named icon (`@cognos/ui/icons`).                                                                             |
| `cog-lozenge`                     | A small status/label badge (tones: neutral/blue/green/purple/red).                                                    |
| `cog-avatar` / `cog-avatar-group` | A user/entity avatar (initials/icon/colour) / stacked avatars.                                                        |

## Navigation & overlays

| Selector                           | When to use                                                              |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `cog-breadcrumbs`                  | Breadcrumb trail (usually via `cog-page-header`).                        |
| `cog-nav-item`                     | A sidebar/nav row.                                                       |
| `cog-drawer`                       | A slide-in panel.                                                        |
| `cog-menu`                         | A dropdown/popover menu.                                                 |
| `cog-sheet`                        | A bottom sheet (mobile-style).                                           |
| `cog-modal` / `cog-dialog-surface` | A centred dialog / the reusable dialog surface chrome.                   |
| `cog-security-modal`               | A security-sensitive confirmation modal.                                 |
| `cog-toast-host`                   | App toast outlet (use `CognosToastService.notify(...)` to raise toasts). |

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

| Selector                                                                        | When to use                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `cog-vault-page` / `cog-vault-card` / `cog-vault-list-row` / `cog-vault-picker` | Vault browsing surfaces.                                                 |
| `cog-storage-meter`                                                             | Storage-usage meter.                                                     |
| `cog-filter-chips`                                                              | Vault-specific filter chips (domain-specific; not a generic chip group). |
| `cog-confirm-shred`                                                             | Destructive "shred" confirmation.                                        |
