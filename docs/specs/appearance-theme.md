# Appearance theme: light, dark, and system

Status: Draft

Cognos already has semantic light and dark theme tokens in
`packages/ui/styles/themes.css`. This spec defines how the frontend exposes those themes to users,
how `system` resolves, and how the active theme is applied without creating a second colour system.

## Goals

- Add an Appearance setting with exactly three choices: **Light**, **Dark**, and **System**.
- Default new users and new devices to **System**.
- Apply the resolved theme automatically from the device preference when **System** is selected.
- React to runtime device colour-scheme changes while **System** is selected.
- Persist the user's chosen preference across reloads and signed-in devices.
- Keep UI colours sourced from existing `--cog-*` design tokens.

## Non-goals

- Creating new colour tokens or changing the current light/dark palettes.
- Adding per-chat, per-project, or scheduled theme preferences.
- Adding custom accent selection. Existing `data-accent` behaviour stays unchanged.
- Using theme preference as a privacy/security signal.

## Definitions

Theme preference is what the user chooses:

```ts
type ThemePreference = 'light' | 'dark' | 'system';
```

Resolved theme is what the DOM receives:

```ts
type ResolvedTheme = 'light' | 'dark';
```

`system` must never be written to `data-theme`. It resolves to `light` or `dark` using
`window.matchMedia('(prefers-color-scheme: dark)')`.

## User experience

### Settings placement

Add an **Appearance** card on `/account`, near the existing Language card.

The card contains a single-select control with:

| Value    | Label  | Behaviour                                      |
| -------- | ------ | ---------------------------------------------- |
| `system` | System | Follow the device colour-scheme preference.    |
| `light`  | Light  | Always use the light token set on this device. |
| `dark`   | Dark   | Always use the dark token set on this device.  |

Use existing `@cognos/ui-angular` primitives. `cog-choice-chip-group` is sufficient unless the
implementation needs per-option descriptions.

### Copy

Suggested English source strings:

- `account.appearance.title`: `Appearance`
- `account.appearance.subtitle`: `Choose how Cognos looks on this device.`
- `account.appearance.label`: `Theme`
- `account.appearance.system`: `System`
- `account.appearance.light`: `Light`
- `account.appearance.dark`: `Dark`
- `account.appearance.systemHintLight`: `Following your device. Currently using light mode.`
- `account.appearance.systemHintDark`: `Following your device. Currently using dark mode.`

Add translations for every supported locale (`en`, `de`, `fr`, `es`, `pt`, `it`) and keep
translation parity tests passing.

### Behaviour

- Selecting an option applies immediately; there is no Save button.
- When `system` is selected, the UI shows which resolved mode is currently active.
- When `light` or `dark` is selected, OS/device colour-scheme changes do not affect the app.
- When `system` is selected, OS/device colour-scheme changes update the app live.
- Theme changes must not reset chat state, settings form state, vault unlock state, or routing.

## Colour and token rules

- Continue applying themes through the root HTML attribute:

  ```html
  <html data-theme="light" data-accent="emerald">
  ```

  or:

  ```html
  <html data-theme="dark" data-accent="emerald">
  ```

- Components must read `--cog-*` tokens only. Do not add component-level hard-coded light/dark
  colours.
- `packages/ui/styles/themes.css` remains the source of truth for theme colours.
- If a missing semantic token is discovered during implementation, add the token to both light and
  dark themes before using it.
- Set the browser native control hint alongside the attribute:

  ```ts
  document.documentElement.style.colorScheme = resolvedTheme;
  ```

## Resolution and startup

### Resolution algorithm

```ts
function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';
  return prefersDark ? 'dark' : 'light';
}
```

Invalid stored values are ignored and treated as `system`.

If `matchMedia` is unavailable, `system` resolves to `light`.

### Preventing a light/dark flash

The initial theme must be applied before Angular renders.

Add a small pre-bootstrap resolver in `frontend/src/index.html` or equivalent app-initializer path
that:

1. Reads `localStorage['cognos:theme']`.
2. Defaults to `system` when no valid preference is present.
3. Resolves `system` from `prefers-color-scheme`.
4. Sets `<html data-theme="light|dark">` and `color-scheme` before first paint.

The Angular service then takes over after boot and reconciles account state.

## Persistence

Use two layers, matching the language preference pattern:

1. **Device-local:** `localStorage['cognos:theme']` stores the selected preference
   (`light`, `dark`, or `system`) so the next page load can apply before Angular and before auth.
2. **Signed-in account:** add `users.preferred_theme` as an optional plaintext user field with valid
   values `light`, `dark`, `system`.

Theme preference is not sensitive. It is intentionally not stored in the encrypted
`user_preferences` payload because the app needs it before the vault is unlocked and before any
user data is decrypted.

Authenticated reconciliation:

- If the signed-in user has a valid `preferred_theme`, it becomes authoritative and is mirrored to
  `localStorage`.
- If the signed-in user has no saved theme, capture the current local preference to
  `users.preferred_theme` once.
- If saving to the backend fails, keep the local theme active for the current session and retry only
  on the next user-initiated change or auth reconciliation.

## Runtime service shape

Add a frontend `ThemeService` responsible for:

- current preference signal: `ThemePreference`
- current resolved theme signal: `ResolvedTheme`
- `use(preference: ThemePreference): void`
- applying `data-theme` and `color-scheme` to `document.documentElement`
- listening to `matchMedia('(prefers-color-scheme: dark)')` changes
- reconciling with `AuthService.user$`
- persisting to localStorage and `users.preferred_theme`

The service must only persist the **preference**. It must not persist the resolved theme produced by
`system`.

`@cognos/ui/theme` may keep `THEMES = ['light', 'dark']` for resolved DOM themes. If shared helpers
are added, name them around preferences (for example `THEME_PREFERENCES`) so `system` is not
confused with a concrete CSS theme.

## Backend/data model

Add a PocketBase users migration for `preferred_theme`:

- collection: `_pb_users_auth_`
- field: `preferred_theme`
- type: text or select
- optional
- allowed values/pattern: `light|dark|system`
- blank means no saved preference yet

Expose an `AuthService.setPreferredTheme(theme: ThemePreference)` method mirroring
`setPreferredLanguage`.

## Accessibility

- The selector must be keyboard reachable and screen-reader labelled.
- The selected option must expose selected/pressed state.
- Focus indicators must use existing tokenised component styles.
- Both resolved themes must meet the current contrast expectations of the design system.

## Tests

Required coverage:

- Unit: theme preference validation defaults invalid values to `system`.
- Unit: `system` resolves to dark when `prefers-color-scheme: dark` matches.
- Unit: `system` resolves to light when no dark preference matches or `matchMedia` is unavailable.
- Unit: runtime media-query changes update the resolved theme only when preference is `system`.
- Unit: explicit `light`/`dark` ignores runtime media-query changes.
- Unit: selecting a preference writes that preference to localStorage, not the resolved theme.
- Browser e2e: `/account` shows Light/Dark/System and the selected choice is persisted.
- Browser e2e: choosing Dark sets `<html data-theme="dark">` and survives reload.
- Browser e2e: choosing System follows Playwright's emulated colour scheme on reload.
- Browser e2e: authenticated changes PATCH `preferred_theme` without writing encrypted preference
  data.
- i18n: translation parity remains green for all supported languages.

## Acceptance criteria

- A user can choose Light, Dark, or System from settings.
- The default preference for new users/devices is System.
- The active theme is applied before the first Angular-rendered screen.
- The app updates live when the OS theme changes and the preference is System.
- The preference survives reloads and follows the signed-in user to another device.
- No new hard-coded UI colours are introduced in frontend or ui-angular components.
