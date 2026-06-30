# Design token audit

Date: 2026-06-30

## Resolution (2026-06-30)

Priority 1 and the colour work in Priority 2 are **done**. Summary of what shipped:

- **New tokens added** to `packages/ui` (`themes.css` + `tokens.json` + `DESIGN_SYSTEM.md`),
  light and dark: `--cog-warning(-bg/-text)`, `--cog-danger-bg`, `--cog-danger-border`,
  `--cog-success-border`, `--cog-neutral-bg`.
- **Undefined `--cog-*` references eliminated.** Every token used in `frontend/src`,
  `packages/ui-angular/src` and `web` now resolves to a defined token (verified by diffing
  used-vs-defined). Renames: `border-strong→border-bold`, `fs-body-xs→caption`,
  `fs-h4→h-sm`, `fs-title→h-md`/`h-lg` (by context), `info/success/danger-surface→-bg`,
  `sunken→surface-sunken`, `text-danger→danger-text`, `shadow-{200,lg}→overlay`,
  `shadow-sm→raised`.
- **Off-grid values snapped to the scale** (decision: snap, don't extend the grid):
  `space-50→050`, `space-75→075`, `space-125→150`, `space-175→200`, `fs-h-xl→display`.
  Note: `fs-h-xl` was 32–36px on the pricing/billing heroes and is now `--cog-fs-display`
  (24px) — a deliberate, visible shrink to keep the type scale honest.
- **Component-scoped vars de-tokenised.** Per-instance CSS custom properties set via
  `[style.--…]` bindings (icon size, modal/dialog width, avatar overlap, nav width,
  progress tone) and the avatar hue palette were renamed from `--cog-*` to private `--_*`
  (decision: keep avatar palette component-local). Specs updated.
- **Redundant fallbacks dropped.** Tokens load globally via `angular.json`, so the inline
  `var(--cog-*, <fallback>)` fallbacks in the app were dead code that could drift from the
  theme — 355 stripped across 28 frontend files. The mobile model-sheet backdrop now uses
  `var(--cog-scrim)` instead of raw `rgba(0,0,0,.4)`.
- **Storybook now loads the tokens** (`preview.ts`), so library components render against the
  real `--cog-*` variables rather than their inline fallbacks.

### Deliberately left for review (Priority 3, raw scale)

The raw spacing/weight values (≈107 grid-matching `gap/padding/margin` occurrences, ≈16
`font-weight` literals, spread thinly across ~40 files) were **not** blanket-converted. They
render identically today, this tier was filed as "review" not "fix", and an automated sweep
risks mis-handling shorthands and coincidental grid matches. Tokenise these per-file when
touching the component. Media chrome in the image/lightbox components (always-dark scrims +
white text) and the `styles.scss` alpha-mask gradients are intentionally non-token and stay.

---

## Original audit

## Scope

Checked `packages/ui-angular/src` and `frontend/src` for places that should use the shared
`packages/ui` design tokens. Generated/cache output was ignored.

Token source of truth:

- `packages/ui/styles/tokens.css`
- `packages/ui/styles/themes.css`
- `packages/ui/tokens.json`

## Summary

| Finding                                                                             | Impact                                                            |        Files to touch |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------: |
| Unknown/ad-hoc `--cog-*` variables not defined by `packages/ui`                     | Fallbacks hide broken token usage and can drift by theme          |                    29 |
| Hard-coded colours (`#`, `rgb()`, `rgba()`, `white`, `black`) in app/library styles | Inconsistent dark mode, accent switching, and semantic colour use |                    32 |
| Repeated raw spacing/type/radius/shadow values                                      | Components can drift from the 8px/2px grid and type scale         | 95 flagged for review |
| Inline styles in Storybook examples                                                 | Lower priority, but examples teach non-token patterns             |         6 story files |

## Priority 1: replace or promote unknown `--cog-*` variables

These variables are used as if they are design tokens but are not defined in `packages/ui`.

| Token used                                                                                                                                                                                       | Suggested action                                                                                                            | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--cog-space-50`                                                                                                                                                                                 | Rename to `--cog-space-050`                                                                                                 | `frontend/src/app/components/chat/conversation-memory/conversation-memory.component.scss`, `frontend/src/app/components/chat/message-form/message-form.component.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `--cog-space-75`                                                                                                                                                                                 | Rename to `--cog-space-075`                                                                                                 | `frontend/src/app/pages/personas/personas-page.component.css`, `frontend/src/app/components/personas/persona-editor/persona-editor.component.css`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--cog-space-125`                                                                                                                                                                                | Snap to `--cog-space-100` or `--cog-space-150`; only add token if 10px is approved                                          | `packages/ui-angular/src/lib/overlays/menu/menu.component.ts`, `frontend/src/app/pages/projects/projects-page.component.css`, `frontend/src/app/pages/projects/project-detail.component.css`, `frontend/src/app/pages/personas/personas-page.component.css`, `frontend/src/app/pages/public-conversation/public-conversation.component.ts`, `frontend/src/app/components/vault-password-dialog/vault-password-dialog.component.ts`, `frontend/src/app/components/account/data-processing/data-processing.component.ts`, `frontend/src/app/components/personas/persona-editor/persona-editor.component.css` |
| `--cog-space-175`                                                                                                                                                                                | Snap to `--cog-space-150` or `--cog-space-200`; only add token if 14px is approved                                          | `frontend/src/app/pages/projects/project-detail.component.css`, `frontend/src/app/components/account/data-processing/data-processing.component.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--cog-border-strong`                                                                                                                                                                            | Use `--cog-border-bold`                                                                                                     | `frontend/src/app/pages/personas/personas-page.component.css`, `frontend/src/app/components/account/data-processing/data-processing.component.ts`, `frontend/src/app/components/chat/message-form/persona-chips/persona-chips.component.ts`                                                                                                                                                                                                                                                                                                                                                                |
| `--cog-success-surface`                                                                                                                                                                          | Use `--cog-success-bg`                                                                                                      | `frontend/src/app/pages/personas/personas-page.component.css`, `frontend/src/app/components/chat/message-form/persona-chips/persona-chips.component.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--cog-info-surface`                                                                                                                                                                             | Use `--cog-info-bg`                                                                                                         | `frontend/src/app/components/personas/persona-editor/persona-editor.component.css`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--cog-text-danger`                                                                                                                                                                              | Use `--cog-danger-text`                                                                                                     | `frontend/src/app/pages/account/account.component.ts`, `frontend/src/app/components/share-conversation-dialog/share-conversation-dialog.component.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--cog-sunken`                                                                                                                                                                                   | Use `--cog-surface-sunken`                                                                                                  | `packages/ui-angular/src/lib/images/image-thumb/image-thumb.component.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--cog-shadow-200`, `--cog-shadow-lg`, `--cog-shadow-sm`                                                                                                                                         | Use `--cog-shadow-raised` or `--cog-shadow-overlay`                                                                         | `frontend/src/app/components/chat/message-form/message-form.component.ts`, `frontend/src/app/components/chat/message-form/composer-tools/composer-tools.component.ts`, `frontend/src/app/components/billing/switch-plan-modal/switch-plan-modal.component.scss`                                                                                                                                                                                                                                                                                                                                            |
| `--cog-fs-title`                                                                                                                                                                                 | Use `--cog-fs-h-lg`/`--cog-fs-h-md`                                                                                         | `frontend/src/app/pages/projects/project-detail.component.css`, `frontend/src/app/components/chat/message-form/model-selector/model-selector.component.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--cog-fs-h-xl`                                                                                                                                                                                  | Use `--cog-fs-display`/`--cog-fs-h-lg`, or add an approved larger heading token                                             | `frontend/src/app/pages/pricing/pricing.component.scss`, `frontend/src/app/pages/account/billing/plan-billing.component.scss`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--cog-fs-h4`                                                                                                                                                                                    | Use `--cog-fs-h-sm`                                                                                                         | `frontend/src/app/components/duplicating-dialog/duplicating-dialog.component.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--cog-fs-body-xs`                                                                                                                                                                               | Use `--cog-fs-caption`                                                                                                      | `frontend/src/app/components/chat/message-form/message-form.component.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--cog-danger-border`, `--cog-danger-surface`, `--cog-success-border`, `--cog-warning`, `--cog-warning-text`, `--cog-neutral-bg`                                                                 | Decide whether these semantic tokens belong in `packages/ui`; otherwise map to existing status/lozenge tokens               | `frontend/src/app/pages/projects/project-detail.component.css`, `frontend/src/app/pages/account/account.component.ts`, `packages/ui-angular/src/lib/layout/auth-page/auth-page.component.ts`, `frontend/src/app/components/billing/switch-plan-modal/switch-plan-modal.component.scss`, `frontend/src/app/components/chat/message-form/composer-tools/composer-tools.component.ts`, `frontend/src/app/pages/account/mfa-settings.component.ts`                                                                                                                                                             |
| `--cog-avatar-bg`, `--cog-avatar-fg`, `--cog-avatar-group-overlap`, `--cog-desktop-shell-nav-width`, `--cog-dialog-surface-width`, `--cog-icon-size`, `--cog-modal-width`, `--cog-progress-tone` | Component-scoped variables. Either promote to real design tokens or rename to private component vars such as `--_avatar-bg` | `packages/ui-angular/src/lib/primitives/avatar/avatar.component.ts`, `packages/ui-angular/src/lib/primitives/avatar-group/avatar-group.component.ts`, `packages/ui-angular/src/lib/layout/desktop-shell/desktop-shell.component.ts`, `packages/ui-angular/src/lib/overlays/dialog-surface/dialog-surface.component.ts`, `packages/ui-angular/src/lib/icon/icon.component.ts`, `packages/ui-angular/src/lib/overlays/modal/modal.component.ts`, `packages/ui-angular/src/lib/files/progress/progress.component.ts`                                                                                          |

## Priority 2: hard-coded colour opportunities

High-confidence cases where semantic tokens should replace fixed palette values.

| Area                            | Issue                                                                                                                                                      | Files to touch                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persona/avatar colour palettes  | Tailwind-style fixed swatches are repeated across app and library. Consider shared persona/avatar palette tokens, or map to existing lozenge/status tones. | `packages/ui-angular/src/lib/primitives/avatar/avatar.component.ts`, `frontend/src/app/components/personas/persona-avatar/persona-avatar.component.ts`, `frontend/src/app/components/personas/persona-editor/persona-editor.component.css`, `frontend/src/app/pages/personas/personas-page.component.css`                                                                                                                                                   |
| Persona pages/editor            | Many token fallbacks are old Slate/Tailwind values and some token names do not exist.                                                                      | `frontend/src/app/pages/personas/personas-page.component.css`, `frontend/src/app/components/personas/persona-editor/persona-editor.component.css`                                                                                                                                                                                                                                                                                                           |
| Project pages                   | Old fallback colours and non-existent danger/status tokens.                                                                                                | `frontend/src/app/pages/projects/project-detail.component.css`, `frontend/src/app/pages/projects/projects-page.component.css`                                                                                                                                                                                                                                                                                                                               |
| Chat header warning pill        | Amber colours are hard-coded. Add/use warning tokens if warning is a first-class semantic state.                                                           | `frontend/src/app/components/chat/chat-header/chat-header.component.scss`                                                                                                                                                                                                                                                                                                                                                                                   |
| Chat composer and selectors     | Overlay/shadow fallbacks and selected/hover fallbacks use raw `rgba()`.                                                                                    | `frontend/src/app/components/chat/message-form/message-form.component.ts`, `frontend/src/app/components/chat/message-form/model-selector/model-selector.component.ts`, `frontend/src/app/components/chat/message-form/persona-switcher/persona-switcher.component.ts`, `frontend/src/app/components/chat/message-form/composer-tools/composer-tools.component.ts`, `frontend/src/app/components/chat/message-form/persona-chips/persona-chips.component.ts` |
| Image overlays/lightbox         | Black scrims and white text are hard-coded. Prefer `--cog-scrim`, `--cog-on-brand`, or introduce image-overlay tokens.                                     | `packages/ui-angular/src/lib/images/image-thumb/image-thumb.component.ts`, `packages/ui-angular/src/lib/images/lightbox/lightbox.component.ts`, `packages/ui-angular/src/lib/images/image-grid/image-grid.component.ts`                                                                                                                                                                                                                                     |
| Global visual utilities         | `rgba()` masks/debug colours are fixed. Some may be acceptable utilities, but should be reviewed.                                                          | `frontend/src/styles.scss`                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Account/billing/status surfaces | Status colours use raw fallbacks and missing tokens.                                                                                                       | `frontend/src/app/pages/account/account.component.ts`, `frontend/src/app/pages/account/mfa-settings.component.ts`, `frontend/src/app/pages/account/settings-shell.component.ts`, `frontend/src/app/components/billing/switch-plan-modal/switch-plan-modal.component.scss`, `frontend/src/app/components/account/data-processing/data-processing.component.ts`                                                                                               |
| Logo components                 | Inline SVG/component colours are fixed. Confirm whether they are brand assets or should consume `currentColor`/brand tokens.                               | `frontend/src/app/components/cognos-logo/cognos-logo.component.ts`, `frontend/src/app/components/paddle-logo/paddle-logo.component.ts`                                                                                                                                                                                                                                                                                                                      |

## Priority 3: raw spacing/type/radius/shadow values to review

Many values are legitimate component dimensions, but these files have enough raw visual values to be
worth reviewing against the token scale.

| File                                                                                       | Main opportunity                                                                                  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `frontend/src/app/pages/personas/personas-page.component.css`                              | Replace raw 10/14px spacing, pill radii, shadows, and old fallbacks with token scale values.      |
| `frontend/src/app/pages/projects/project-detail.component.css`                             | Replace raw 10/14px spacing and old type aliases with official type/space tokens.                 |
| `frontend/src/app/components/personas/persona-editor/persona-editor.component.css`         | Replace raw 10/14px spacing and old fallbacks; align info/status surfaces.                        |
| `frontend/src/app/pages/public-conversation/public-conversation.component.ts`              | Review raw spacing/type/radius values in inline component styles.                                 |
| `frontend/src/app/components/chat/message-form/message-form.component.ts`                  | Replace raw shadows, 16px font fallbacks, 2/4/8/10px spacing with existing tokens where possible. |
| `frontend/src/app/components/chat/message-form/model-selector/model-selector.component.ts` | Review raw menu dimensions and type aliases; keep only truly layout-specific sizes.               |
| `frontend/src/app/pages/pricing/pricing.component.scss`                                    | Replace non-existent heading token and raw layout spacing with official tokens.                   |
| `frontend/src/app/pages/account/billing/plan-billing.component.scss`                       | Replace non-existent heading token and raw layout spacing with official tokens.                   |
| `packages/ui-angular/src/lib/vault/vault-page/vault-page.component.ts`                     | Align library component spacing with `--cog-space-*`.                                             |
| `packages/ui-angular/src/lib/vault/storage-meter/storage-meter.component.ts`               | Align library component spacing/sizes with tokens where not data-driven.                          |
| `packages/ui-angular/src/lib/vault/vault-picker/vault-picker.component.ts`                 | Align library component spacing with tokens.                                                      |
| `packages/ui-angular/src/lib/files/doc-attachment/doc-attachment.component.ts`             | Align file primitive spacing/type with tokens.                                                    |
| `packages/ui-angular/src/lib/files/upload-row/upload-row.component.ts`                     | Align file primitive spacing/type with tokens.                                                    |
| `packages/ui-angular/src/lib/files/dropzone/dropzone.component.ts`                         | Align file primitive spacing/type with tokens.                                                    |
| `packages/ui-angular/src/lib/images/model-image/model-image.component.ts`                  | Replace raw type/spacing in captions and controls; keep image dimensions if intentional.          |
| `packages/ui-angular/src/lib/conversation/source-card/source-card.component.ts`            | Align conversation primitive spacing/type with tokens.                                            |
| `packages/ui-angular/src/lib/conversation/vault-ref-chip/vault-ref-chip.component.ts`      | Align chip spacing/type with lozenge/token specs.                                                 |
| `packages/ui-angular/src/lib/toast/toast-host/toast-host.component.ts`                     | Align toast spacing/shadow/motion with tokens.                                                    |

## Lower priority: Storybook inline styles

Story files are not product UI, but they currently model inline, hard-coded styling. Move repeated
demo layout styles into classes using tokens.

- `packages/ui-angular/src/lib/foundations/colours.stories.ts`
- `packages/ui-angular/src/lib/foundations/typography.stories.ts`
- `packages/ui-angular/src/lib/files/overview.stories.ts`
- `packages/ui-angular/src/lib/images/overview.stories.ts`
- `packages/ui-angular/src/lib/primitives/avatar/avatar.stories.ts`
- `packages/ui-angular/src/lib/primitives/list/list.stories.ts`

## Complete touch list

### Definite token fixes

- `packages/ui-angular/src/lib/files/progress/progress.component.ts`
- `packages/ui-angular/src/lib/icon/icon.component.ts`
- `packages/ui-angular/src/lib/images/image-thumb/image-thumb.component.ts`
- `packages/ui-angular/src/lib/layout/auth-page/auth-page.component.ts`
- `packages/ui-angular/src/lib/layout/desktop-shell/desktop-shell.component.ts`
- `packages/ui-angular/src/lib/overlays/dialog-surface/dialog-surface.component.ts`
- `packages/ui-angular/src/lib/overlays/menu/menu.component.ts`
- `packages/ui-angular/src/lib/overlays/modal/modal.component.ts`
- `packages/ui-angular/src/lib/primitives/avatar-group/avatar-group.component.ts`
- `packages/ui-angular/src/lib/primitives/avatar/avatar.component.ts`
- `frontend/src/app/components/account/data-processing/data-processing.component.ts`
- `frontend/src/app/components/billing/switch-plan-modal/switch-plan-modal.component.scss`
- `frontend/src/app/components/chat/conversation-memory/conversation-memory.component.scss`
- `frontend/src/app/components/chat/message-form/composer-tools/composer-tools.component.ts`
- `frontend/src/app/components/chat/message-form/message-form.component.ts`
- `frontend/src/app/components/chat/message-form/model-selector/model-selector.component.ts`
- `frontend/src/app/components/chat/message-form/persona-chips/persona-chips.component.ts`
- `frontend/src/app/components/duplicating-dialog/duplicating-dialog.component.ts`
- `frontend/src/app/components/personas/persona-editor/persona-editor.component.css`
- `frontend/src/app/components/share-conversation-dialog/share-conversation-dialog.component.ts`
- `frontend/src/app/components/vault-password-dialog/vault-password-dialog.component.ts`
- `frontend/src/app/pages/account/account.component.ts`
- `frontend/src/app/pages/account/billing/plan-billing.component.scss`
- `frontend/src/app/pages/account/mfa-settings.component.ts`
- `frontend/src/app/pages/personas/personas-page.component.css`
- `frontend/src/app/pages/pricing/pricing.component.scss`
- `frontend/src/app/pages/projects/project-detail.component.css`
- `frontend/src/app/pages/projects/projects-page.component.css`
- `frontend/src/app/pages/public-conversation/public-conversation.component.ts`

### Colour-token review

- `packages/ui-angular/src/lib/button/button.component.ts`
- `packages/ui-angular/src/lib/images/image-grid/image-grid.component.ts`
- `packages/ui-angular/src/lib/images/lightbox/lightbox.component.ts`
- `packages/ui-angular/src/lib/primitives/toggle/toggle.component.ts`
- `frontend/src/app/components/chat/chat-header/chat-header.component.scss`
- `frontend/src/app/components/chat/feature-bento/feature-bento.component.ts`
- `frontend/src/app/components/chat/message-form/persona-switcher/persona-switcher.component.ts`
- `frontend/src/app/components/chat/sidebar-profile/sidebar-profile.component.ts`
- `frontend/src/app/components/cognos-logo/cognos-logo.component.ts`
- `frontend/src/app/components/paddle-logo/paddle-logo.component.ts`
- `frontend/src/app/components/personas/persona-avatar/persona-avatar.component.ts`
- `frontend/src/app/pages/account/settings-shell.component.ts`
- `frontend/src/app/pages/chat/chat.component.scss`
- `frontend/src/styles.scss`

### Raw scale review

- `packages/ui-angular/src/lib/conversation/code-block/code-block.component.ts`
- `packages/ui-angular/src/lib/conversation/source-card/source-card.component.ts`
- `packages/ui-angular/src/lib/conversation/sources-row/sources-row.component.ts`
- `packages/ui-angular/src/lib/conversation/vault-ref-chip/vault-ref-chip.component.ts`
- `packages/ui-angular/src/lib/files/audio-note/audio-note.component.ts`
- `packages/ui-angular/src/lib/files/doc-attachment/doc-attachment.component.ts`
- `packages/ui-angular/src/lib/files/dropzone/dropzone.component.ts`
- `packages/ui-angular/src/lib/files/upload-row/upload-row.component.ts`
- `packages/ui-angular/src/lib/foundations/icon-showcase/icon-showcase.component.ts`
- `packages/ui-angular/src/lib/images/model-image/model-image.component.ts`
- `packages/ui-angular/src/lib/layout/desktop-shell/desktop-shell-showcase/desktop-shell-showcase.component.ts`
- `packages/ui-angular/src/lib/toast/toast-host/toast-host.component.ts`
- `packages/ui-angular/src/lib/vault/storage-meter/storage-meter.component.ts`
- `packages/ui-angular/src/lib/vault/vault-card/vault-card.component.ts`
- `packages/ui-angular/src/lib/vault/vault-list-row/vault-list-row.component.ts`
- `packages/ui-angular/src/lib/vault/vault-page/vault-page.component.ts`
- `packages/ui-angular/src/lib/vault/vault-picker/vault-picker.component.ts`
