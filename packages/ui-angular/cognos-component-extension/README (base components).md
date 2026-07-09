# Cognos Design System — Build Reference

Everything needed to build the `@cognos/ui` component library. Tokens are the
source of truth in **`tokens.json`** (machine-readable) and **`tokens.css`**
(drop-in CSS variables). This doc explains how to apply them and specs each
component. Lineage: **Atlassian Design System** conventions with an **Emerald**
brand accent.

> Themed with two HTML attributes: `data-theme="light|dark"` and
> `data-accent="emerald|blue"`. Components consume only semantic `--cog-*`
> variables — never raw hex — so retheming is attribute-only.

---

## 1. Foundations

### 1.1 Typography

- **Families** (`--cog-font*`): System UI stack is the default. The library
  exposes a `font` theme option that swaps the root `--cog-font` to **Atkinson
  Hyperlegible** (accessibility), **Inter**, or **Noto Sans**. Only the variable
  changes; never hard-code a family in a component.
- **Type scale** (`font.scale` in tokens.json):

  | Token        | Size / Line / Weight                   | Where                              |
  | ------------ | -------------------------------------- | ---------------------------------- |
  | `display`    | 1.5rem / 1.2 / 600                     | empty-state hero                   |
  | `heading.lg` | 1.5rem / 1.25 / 600                    | project title                      |
  | `heading.md` | 1.25rem / 1.3 / 600                    | page & dialog titles               |
  | `heading.sm` | 1rem / 1.35 / 600                      | card / nav header                  |
  | `body.lg`    | 0.9375rem / 1.6 / 400                  | chat message body                  |
  | `body`       | 0.875rem / 1.45 / 400                  | default UI text                    |
  | `body.sm`    | 0.8125rem / 1.45 / 400                 | supporting text                    |
  | `caption`    | 0.75rem / 1.4 / 400                    | meta, timestamps, key fingerprints |
  | `label`      | 0.875rem / 1.0 / 500                   | button labels                      |
  | `overline`   | 0.6875rem / 1.4 / 700 · 0.04em · UPPER | section headers                    |
  | `lozenge`    | 0.6875rem / 1.4 / 700 · 0.02em · UPPER | lozenge/tag text                   |

### 1.2 Spacing

0.5rem grid with a 0.125rem base step (`--cog-space-*`): **0.125, 0.25, 0.375,
0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4rem**. Content gutters: **1rem**
(mobile), **1.5–1.75rem** (desktop). Vertical stack rhythm: 0.5 / 0.75 / 1 /
1.5rem. Touch targets ≥ **44px** on mobile, ≥ 32px on desktop.

### 1.3 Radius

`xs 0.1875rem` (buttons, controls, lozenges) · `sm 0.25rem` (fields, menus,
inner cards) · `md 0.5rem` (cards, dialogs, message bubbles) · `lg 1rem`
(bottom-sheet top corners) · `pill 9999px` (avatars, toggles).

### 1.4 Elevation

Near-flat. Two recipes only: `--cog-shadow-raised` (cards/popovers at rest) and
`--cog-shadow-overlay` (menus, dialogs, sheets). Scrim for modals/sheets:
`--cog-scrim` = `rgba(9,30,66,0.54)`. Surfaces separate primarily by **color
contrast + 1px border**, not shadow.

### 1.5 Motion

`fast 100ms` (hover/press state fills) · `medium 150ms` (overlay fade/open) ·
`sheet 260ms` (bottom-sheet & drawer slide). Easing `--cog-ease-standard`
= `cubic-bezier(0.16,1,0.3,1)`. Honor `prefers-reduced-motion`.

### 1.6 Color roles

See `tokens.json` / `tokens.css`. Key semantic roles components should use:

- Surfaces: `app-bg`, `nav-bg`, `surface`, `surface-raised`, `surface-sunken`, `surface-hover`,
  `surface-pressed`
- Text: `text`, `text-subtle`, `text-subtlest`, `text-disabled`
- Lines: `border`, `border-bold`
- Brand/accent: `brand`, `brand-hover`, `brand-pressed`, `on-brand`, `link`, `selected-bg`,
  `selected-text`, `selected-border`
- Status: `success(-bg/-text)`, `danger(-text)`, `info(-bg/-text)`
- Lozenge tones: `loz-{neutral|blue|green|purple|red}-{bg|fg}`

> **Accent vs. semantic green:** the brand accent is emerald, but the success/
> "encrypted" semantics are their own green tokens. When accent = emerald they
> read as one family by design; the **toggle "on" state is always
> `--cog-success`**, independent of accent.

---

## 2. Iconography

- **Set:** [Lucide](https://lucide.dev), rendered as **inline SVG** using
  `stroke="currentColor"`, `stroke-width: var(--cog-icon-stroke)` (2),
  `linecap/linejoin: round`. Outline only — never filled.
- **Sizes:** 12 / 14 / 16 / 18 / 20 / 24. Default UI icon = 16; nav/message = 18;
  status/decorative = 12–14.
- **Color:** follows text role — `text-subtle`/`text-subtlest` at rest,
  `selected-text` or `link` when active/selected.
- **Recommended package:** `lucide-react`. Wrap in an `<Icon name size />` that
  maps to the named export, so app code stays declarative.

**Canonical name map** (semantic → Lucide):

| Meaning             | Lucide                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| encryption / sealed | `lock`                                                                                                      |
| security / verified | `shield-check`, `shield`                                                                                    |
| key / fingerprint   | `key-round`                                                                                                 |
| only-you / hidden   | `eye-off`                                                                                                   |
| search              | `search` · on-device hint `laptop`                                                                          |
| new / add           | `plus`                                                                                                      |
| chat / message      | `message-square`                                                                                            |
| send                | `send`                                                                                                      |
| attach              | `paperclip`                                                                                                 |
| prompts library     | `book-text`                                                                                                 |
| skills              | `sparkles`                                                                                                  |
| model · on-prem     | `server` · cloud `cloud` · this-device `laptop`                                                             |
| project · gov       | `landmark` · edu `graduation-cap` · private `lock` · generic `folder`                                       |
| people / team       | `users`                                                                                                     |
| share / invite      | `user-plus`                                                                                                 |
| menu (mobile)       | `menu` · more `more-horizontal`                                                                             |
| chevrons            | `chevron-right`, `chevron-down`, `chevron-left`                                                             |
| close / revoke      | `x`                                                                                                         |
| check               | `check`                                                                                                     |
| edit                | `pencil` · settings `settings` · rotate `rotate-cw`                                                         |
| copy / regen / like | `copy`, `refresh-cw`, `thumbs-up`                                                                           |
| cite / sources      | `quote`                                                                                                     |
| pin                 | `pin`                                                                                                       |
| link share          | `link` · email `mail`                                                                                       |
| devices             | `monitor-smartphone`                                                                                        |
| skill: redact       | `eraser` · cite `quote` · statute `scale` · translate `languages` · table `table` · lesson `graduation-cap` |
| status bar          | `signal`, `wifi`, `battery-medium`                                                                          |

---

## 3. Components

Common state model: **rest → hover (`surface-hover`) → pressed
(`surface-pressed`) → disabled (opacity 0.5, no pointer)**. Focus-visible: 2px
`--cog-brand` outline at 2px offset (add globally for a11y).

### Button — `<Button appearance icon iconAfter size>`

- Height **32** (desktop) / **40–44** (mobile, `size="lg"`). Radius `xs`.
  Padding `0 12`. Gap `6`. Label = `label` (14/500). Icon 16.
- Appearances → token map:
    - `primary`: bg `brand` (hover `brand-hover`, pressed `brand-pressed`), text `on-brand`.
    - `default`: bg `surface-hover`-family neutral (`--cog-surface-hover` at rest, `surface-pressed`
      pressed)… use `loz-neutral` pairing: bg neutral `#F1F2F4`/dark `#2C333A`, text `text-subtle`.
    - `subtle`: transparent → `surface-hover`/`surface-pressed`, text `text-subtle`.
    - `link`: transparent, text `link`, padding `0 2`.
    - `danger`: bg `danger`, text `#FFFFFF`.

### IconButton — `<IconButton name title selected size>`

- **32×32** desktop / **40–44** mobile. Radius `xs`. Icon 16 (`text-subtle`).
- Hover `surface-hover`; selected → bg `selected-bg`, icon `selected-text`.

### Lozenge — `<Lozenge tone>`

- Inline, height ~18, padding `1px 5px`, radius `xs`, text `lozenge`
  (11/700/UPPER/0.02em). Tones: `neutral | blue | green | purple | red`
  → `--cog-loz-{tone}-{bg|fg}`. Used for status (ENCRYPTED, VERIFIED), model
  tags (ON-PREM/SWISS CLOUD/THIS DEVICE), roles (OWNER), counts.

### Toggle — `<Toggle checked>`

- Track **28×16**, radius `pill`. Off: transparent + 1px `border-bold`, knob
  `border-bold`. **On: track `--cog-success`** (always green), knob `#FFFFFF`
  with a 9px `check` icon. Knob 12px. Transition `fast`.

### TextField — `<TextField icon value>`

- Height **36** (44 mobile). Radius `xs`. **2px** border `border` → focus
  `brand`. Bg `input-bg` → `input-bg-focus` on focus. Text 14. Leading icon 15
  `text-subtlest`. (The 2px border + brand focus is the signature look.)

### NavItem — `<NavItem icon label meta selected indent pinned>`

- Height **36** desktop / **48** mobile (sub-items 32/44). Radius `sm`. Gap 10–12.
  Icon 16–18. Rest text `text`; hover `surface-hover`.
- **Selected:** bg `selected-bg`, text `selected-text` (weight 600), icon
  `selected-text`, plus a **2–3px left bar** in `selected-border`.
- Section header above groups = `overline`, color `text-subtlest`.

### Menu (desktop popover) — `<Menu>` / `<MenuItem icon title sub trailing selected>`

- Surface `surface`, radius `sm`, shadow `overlay`, padding `4 0`. Item
  min-height **36**, padding `0 12`, gap 10. Hover `surface-hover`; selected bg
  `selected-bg` + check (`trailing`). Optional `sub` line = `body.sm`
  `text-subtlest`.

### Sheet (mobile) — `<Sheet title full footer>`

- Bottom-anchored. Top corners radius `lg`. Drag handle 36×4 `border`. Scrim
  `--cog-scrim`. Slide-up `sheet` duration / standard easing. Max-height **78%**
  (menus) or **94%** (`full`, for dialogs). `full` gets a title row
  (`heading.md` + close `IconButton`) and an optional sticky `footer`.

### Modal (desktop) — `<Modal title width>`

- Surface `surface`, radius `md`, shadow `overlay`, scrim `--cog-scrim`.
  Header: `heading.md` title + close IconButton. Footer: actions right-aligned,
  primary last. Widths used: 540 (share), 580 (security), 560 (prompts).
- **Responsive rule:** below 600px viewport, Modal renders as a `full` Sheet.

### SectionMessage — `<SectionMessage tone="info|success" title icon>`

- Bg `info-bg`/`success-bg`, radius `sm`, padding `12–14`, gap 12. Leading icon
  18 in `info-text`/`success-text`. Optional bold title (`body.sm`/700). Used
  for the "one honest caveat" + the visible-encryption banner.

### Breadcrumbs — `<Breadcrumbs items=[{label,onClick}]>`

- `caption` (12) `text-subtle`, `/` separators in `text-subtlest`. Links
  underline on hover. Last item = current (no link).

### Avatar — `<Avatar name | group size>`

- Circle (`pill`). Bg `brand`, text `on-brand` (initials, 600). Group/team uses
  `users` icon. Sizes 26 / 28 / 32 / 36 / 40. Overlapping stacks use a 2px
  `surface` ring and −8px overlap.

### Chat primitives

- **UserMessage:** right-aligned bubble, bg `selected-bg`, text `text`, radius
  `md md xs md`, max-width 88% (mobile) / 620 (desktop), padding 12–14, body
  `body.lg`. Footer meta = `caption` `text-subtlest` with a `lock` icon
  ("Encrypted · time") or a "Securing…" state with `loader`.
- **AssistantMessage:** 28–30 brand-circle avatar (`lock`, `on-brand`) + a
  header row (`body`/600 model name + green `ENCRYPTED` Lozenge + time) +
  body `body.lg`. Hover reveals copy/regenerate IconButtons; cited replies show
  a `quote` + "N sources" link in `link`. Typing = 3 dots, `aBlink` 1s stagger.
- **Composer:** container bg `surface`, **2px** border `border` → `brand` on
  focus, radius `sm` (mobile) / `sm`. Textarea `body.lg`/16 (16px on mobile to
  avoid iOS zoom). Toolbar row: model menu-button (chevron), prompts/skills/
  attach IconButtons, primary Send. Caption beneath: `lock` + "End-to-end
  encrypted · keys never leave this device" (`caption` `text-subtlest`).

### Layout shells

- **Desktop:** persistent left **Nav** (width 290, bg `nav-bg`, right border) +
  content column. Content header = Breadcrumbs + `heading.md` title + actions.
- **Mobile:** top app bar (56) with `menu` IconButton + title + actions; Nav
  becomes a **Drawer** (≤86% width / 320 max, slide-in `sheet`) over scrim;
  Composer docked bottom with `env(safe-area-inset-bottom)` padding.

---

## 4. Encryption UX conventions (product-specific)

These are first-class patterns, not decoration — bake them into components:

- A `lock` glyph + "Encrypted" affordance lives on every message and the nav
  security card; quiet by default (`text-subtlest`).
- Model tags communicate where compute runs: **ON-PREM** (green), **SWISS
  CLOUD** (blue), **THIS DEVICE** (purple) lozenges.
- Sharing is framed as **"Grant decrypt access"** with key fingerprints, never
  generic "share".
- A one-time **SectionMessage** explains the transient server-plaintext step;
  an optional always-on banner is the "visible" cue (toggle).

---

## 5. Suggested package shape

```text
@cognos/ui
├─ tokens/            # tokens.json (Style Dictionary source)
│   └─ tokens.css     # generated CSS variables (ship in dist)
├─ src/
│   ├─ ThemeProvider  # sets data-theme / data-accent / --cog-font
│   ├─ primitives/    # Button, IconButton, Lozenge, Toggle, TextField, Icon, Avatar
│   ├─ overlays/      # Menu, Sheet, Modal (Modal→Sheet under 600px)
│   ├─ navigation/    # Nav, NavItem, Drawer, Breadcrumbs
│   └─ chat/          # Composer, UserMessage, AssistantMessage, SectionMessage
└─ index.ts
```

- Build with **React + TypeScript**; style with the CSS variables (CSS Modules
  or vanilla-extract). Keep components theme-agnostic — read `--cog-*` only.
- Generate platform tokens from `tokens.json` via **Style Dictionary** if you
  also need iOS/Android.
- Ship `tokens.css` as the single required import; everything else is variables.

```text
import '@cognos/ui/tokens.css';
import { ThemeProvider, Button } from '@cognos/ui';
```
