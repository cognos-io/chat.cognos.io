# Cognos Design System — Component Extension v1

**Engineering Build Reference**

> Audience: implementation team. This document specifies the **new** components
> that extend `@cognos/ui` to handle files, images, and the personal encrypted
> **Vault**. Read it alongside the base **Build Reference** (`README.md`) and the
> token source (`tokens.css` / `tokens.json`). Reference implementation:
> `cognos/Cognos Components.html` + `cognos/ax-*.jsx`.

Lineage: **Atlassian Design System** conventions, **Emerald** brand accent. These
components add nothing to the colour system — they consume only the existing
semantic `--cog-*` variables, so light/dark and emerald/blue retheming is
automatic and must remain attribute-only (`data-theme`, `data-accent`).

---

## 0. How to read this document

- **Units** are CSS pixels unless stated. **Radii / spacing / motion** reference
  base tokens: radius `xs 3 · sm 4 · md 8 · lg 16 · pill 9999`; motion
  `fast 100ms · medium 150ms · sheet 260ms`, easing
  `cubic-bezier(0.16,1,0.3,1)`.
- **Tokens**: every colour is a semantic `--cog-*` token. **Never hard-code hex.**
  If a value below shows hex, it is illustrative of the token's light value —
  bind to the token.
- **Component API** is given as a TypeScript prop interface. The reference build
  is React; the contract (props, states, behaviour) is framework-agnostic.
- **"Done when"** lists the acceptance criteria for each component. A component is
  not complete until every box is satisfiable in **both** themes and **both**
  accents.
- The reference file also contains a documentation harness (`DocSection`, `Spec`,
  `Seg`, `Variant`). **That harness is NOT part of the shipped library** — ignore
  it. Everything in sections 2–5 below ships.

---

## 1. Cross-cutting requirements

### 1.1 The encryption state machine — READ FIRST

Every file, image, and attachment in this extension moves through one lifecycle.
This is a **product guarantee made visible**, not decoration. Implement it once
and reuse it everywhere.

```text
 (selected) ──▶ encrypting ──▶ sealed
                   │
                   └─(failure)─▶ error ──▶ (retry) ──▶ encrypting
```

| State        | Meaning                                                        | UI rule                                                                                                        |
| ------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `encrypting` | Bytes are being encrypted **on the client device**.            | Show determinate progress + on-device wording + `loader` icon. **Never** show a lock or the word "Encrypted".  |
| `sealed`     | Ciphertext + key are written; plaintext discarded from memory. | Show a quiet **green `lock` + "Encrypted"** (token `--cog-success-text`). This is the only success affordance. |
| `error`      | Encryption did not complete.                                   | Show `--cog-danger` border + message + tap-to-retry. The file is **not** stored.                               |

**Hard rules (must pass review):**

1. **Encryption happens on the device, before upload/persist.** Plaintext and
   keys never transit to or rest on Cognos servers. UI copy must reflect this
   ("on this device", "keys never leave this device").
2. **Never render the sealed/lock state until the key is actually written.** No
   optimistic locks.
3. **Decrypted previews are in-memory only.** Thumbnails/lightbox images are
   produced by decrypting to an in-memory `blob:` URL that is **revoked** when the
   view unmounts. The stored artefact is always ciphertext.
4. **Per-file keys.** Each Vault file is independently keyed so a single file can
   be **crypto-shredded** (key destroyed → ciphertext unrecoverable). See §4.8.

### 1.2 Reused base primitives (do not re-implement)

These ship already; the new components compose them: `Button`, `IconButton`,
`Lozenge`, `Toggle`, `TextField`, `Icon`, `Avatar`, `Menu`/`MenuItem`, `Modal`,
`Sheet`, `SectionMessage`, `Breadcrumbs`. New components **must** match their
state model: rest → hover (`--cog-surface-hover`) → pressed
(`--cog-surface-pressed`) → disabled (opacity .5, no pointer); focus-visible =
2px `--cog-brand` outline at 2px offset.

### 1.3 Iconography additions

All icons remain **Lucide**, outline, `currentColor`, stroke 2, round caps. New
names introduced by this extension (semantic → Lucide):

| Meaning             | Lucide                                                                           |
| ------------------- | -------------------------------------------------------------------------------- |
| upload / drop       | `upload`, `upload-cloud`                                                         |
| download            | `download`                                                                       |
| document            | `file-text` · sheet/CSV `table` · image `image` · audio `music` · generic `file` |
| Vault               | `folder-lock` · add to Vault `folder-plus`                                       |
| storage usage       | `hard-drive`                                                                     |
| generate image / AI | `sparkles` · variations `copy-plus`                                              |
| play / pause        | `play`, `pause`                                                                  |
| shred / destroy key | `shield-x`                                                                       |
| warning             | `triangle-alert`                                                                 |
| view toggles        | `layout-grid`, `list`                                                            |
| typeface control    | `type` · light `sun` · dark `moon`                                               |

### 1.4 Accessibility baseline (applies to all)

- Interactive elements are real `<button>`/`<a>`; keyboard-operable; visible
  focus ring (§1.2).
- Hit target ≥ **44px** on touch, ≥ **32px** desktop.
- Icon-only controls carry `title` + `aria-label`.
- Overlays (Lightbox, Modal, Picker, Shred) trap focus, close on **Esc**, restore
  focus to the trigger, and render a scrim (`--cog-scrim`).
- State conveyed by colour (encrypting/sealed/error) is **also** conveyed by icon
    - text. Never colour-only.
- Honour `prefers-reduced-motion` (shimmer/progress animations collapse to a
  static state).

### 1.5 File-type registry (shared)

A single map drives every type badge and icon. Unknown extensions fall back to
`{ icon: 'file', tone: 'neutral', label: <EXT‑UPPER> }`.

| ext                     | icon        | lozenge tone | label        |
| ----------------------- | ----------- | ------------ | ------------ |
| pdf                     | `file-text` | red          | PDF          |
| docx / doc              | `file-text` | blue         | DOCX/DOC     |
| txt / md / rtf          | `file-text` | neutral      | TXT/MD/RTF   |
| csv / xlsx              | `table`     | green        | CSV/XLSX     |
| png / jpg / jpeg / webp | `image`     | purple       | PNG/JPG/WEBP |
| mp3 / wav / m4a         | `music`     | purple       | MP3/WAV/M4A  |

`tone` maps to the existing lozenge token pair `--cog-loz-{tone}-{bg|fg}` (red uses
`--cog-loz-red-{bg|fg}`).

---

## 2. Files & documents

### 2.1 FileBadge

Tinted rounded square showing a file's type glyph. The atom every file UI builds on.

```ts
interface FileBadgeProps {
  ext: string;                 // file extension, case-insensitive
  size?: number;               // px, default 38 (also used: 22 / 26 / 30 / 34 / 40 / 44)
  radius?: number;             // px, default = radius.sm (4); xs for ≤26px
}
```

- **Anatomy:** square `size × size`, `border-radius` per `radius`; background =
  `--cog-loz-{tone}-bg`, glyph colour = `--cog-loz-{tone}-fg`, glyph size
  `round(size × 0.48)`. `tone` resolved from §1.5.
- **Behaviour:** purely presentational; no states.
- **Done when:** all registry types render the correct glyph + tone in both
  themes; unknown ext falls back to neutral `file`.

### 2.2 Progress (`AProgress`)

Thin progress track for encryption/upload.

```ts
interface ProgressProps {
  value?: number;              // 0–100 (determinate)
  indeterminate?: boolean;     // overrides value
  height?: number;             // px, default 4
  tone?: string;               // fill colour token, default --cog-brand
}
```

- **Anatomy:** full-width track, `border-radius` pill, track colour
  `--cog-surface-hover` (light) / `--cog-surface-pressed` (dark); fill = `tone`.
- **Determinate:** fill width = `clamp(0,value,100)%`, transition width
  `250ms ease-out`.
- **Indeterminate:** a 40%-wide chunk sweeps left↔right ~1.1s; collapse to a
  static 40% fill under reduced-motion.
- **Done when:** determinate animates smoothly on value change; success uses
  `--cog-success` when caller passes it.

### 2.3 DocAttachment

A document card used inside message bubbles and lists. Carries the full
encryption state machine (§1.1).

```ts
interface DocAttachmentProps {
  name: string;                       // filename incl. extension
  ext?: string;                       // optional override; else derived from name
  size?: string;                      // e.g. "2.4 MB"
  meta?: string;                      // e.g. "PDF · 18 pages"; defaults to "<LABEL> · <size>"
  state?: 'sealed'|'encrypting'|'error';   // default 'sealed'
  progress?: number;                  // 0–100, required when state==='encrypting'
  width?: number|string;              // default 280; '100%' inside narrow containers
  onClick?: () => void;               // makes the card clickable (hover affordance)
  onRemove?: () => void;              // shows trailing × (hidden while encrypting)
  trailing?: ReactNode;               // optional trailing slot (e.g. download)
}
```

- **Anatomy:** horizontal card, `padding 10px 11px`, `gap 11`, `border 1px`,
  `radius sm`, background `--cog-surface`. Leading `FileBadge size 38`. Middle
  column: name (`body`/14·500, single line, ellipsis) + a status line.
- **Status line per state:**
    - `sealed`: `meta` text + green `lock` + "Encrypted" (caption, `--cog-success-text`).
    - `encrypting`: `Progress` (determinate, `progress`) + `loader` +
    "Encrypting on this device · {N}%".
    - `error`: border = `--cog-danger`; `triangle-alert` + "Couldn't encrypt — tap
    to retry" in `--cog-danger`.
- **Behaviour:** hover (when `onClick`) raises border to `--cog-border-bold`;
  `onRemove` × is hidden while `encrypting`; `error` card is tap-to-retry.
- **Done when:** the three states match §1.1; never shows a lock mid-encrypt;
  text truncates without overflowing the card.

### 2.4 AttachChip

Compact staged-file pill for the composer tray (§3.5).

```ts
interface AttachChipProps {
  name: string;
  ext?: string;
  state?: 'sealed'|'encrypting';      // default 'sealed'
  onRemove?: () => void;
}
```

- **Anatomy:** `height 34`, `radius sm`, `border 1px`, background `--cog-surface`,
  `max-width 220`. `FileBadge size 22 (radius xs)` + name (ellipsis) + trailing
  `lock` (sealed, green) or `loader` (encrypting) + optional × remove.
- **Done when:** truncates long names; remove fires `onRemove`.

### 2.5 Dropzone

Drag-and-drop upload target.

```ts
interface DropzoneProps {
  onFiles?: (files?: FileList) => void;   // fires on drop AND on click-to-browse
  compact?: boolean;                      // reduces padding
}
```

- **Anatomy:** `2px dashed` border, `radius md`. Idle: border
  `--cog-border-bold`, bg `--cog-surface`, `upload-cloud` glyph in a
  `--cog-selected-bg` circle, title "Drag files here to add to your Vault",
  subtitle "or **browse your device**", footer "Files are encrypted on this
  device before they're stored".
- **States:** `dragover` → border `--cog-brand`, bg `--cog-selected-bg`, glyph
  swaps to `lock`, title "Drop to encrypt & add". Transition 120ms.
- **Behaviour:** `preventDefault` on dragover/drop; click anywhere opens the
  native file picker; both routes call `onFiles`.
- **Done when:** dragover state toggles reliably (incl. nested drag-leave);
  keyboard focusable and Enter/Space activates browse.

### 2.6 UploadRow

A single in-flight file being encrypted, in an upload list.

```ts
interface UploadRowProps {
  name: string; ext?: string;
  progress: number;            // 0–100
  done?: boolean;              // true at completion (sealed)
  onCancel?: () => void;       // hidden when done
}
```

- **Anatomy:** `FileBadge 34` + name + right-aligned status (`{N}%` while in
  flight → "Sealed" in `--cog-success-text` when done) + `Progress` bar (fill
  `--cog-success` when done) + sub-line ("Sealing…" with `loader` → "Encrypted on
  this device" with green `lock`). Trailing × cancel while in flight.
- **Behaviour:** on the **last** row reaching 100%, the host emits a success Toast
  (§5.5: "N files encrypted & added to Vault").
- **Done when:** progress + label + sub-line stay in sync; cancel removes the row.

### 2.7 AudioNote

Encrypted voice memo.

```ts
interface AudioNoteProps {
  duration?: string;           // "0:42"
  src?: string;                // decrypted blob URL for playback
  width?: number;              // default 280
}
```

- **Anatomy:** circular play/pause button (36, `--cog-brand` bg, `--cog-on-brand`
  glyph) + waveform (row of ~26 rounded bars, `--cog-border-bold`; played portion
  `--cog-brand`) + right column: monospace duration + green `lock`.
- **Behaviour:** toggles play/pause; played bars fill progressively (reference
  build animates a static portion — production binds to audio currentTime).
- **Done when:** play/pause toggles; waveform reflects progress; encrypted lock
  always present.

---

## 3. Images

### 3.1 ImageThumb

A single encrypted image cell (used inside grids).

```ts
interface ImageThumbProps {
  src: string;                 // decrypted blob URL
  onClick?: () => void;        // opens Lightbox
  height?: number;             // px, default 132 (when cover)
  round?: number;              // radius, default md
  cover?: boolean;             // object-fit cover (default) vs contain
  lock?: boolean;              // show lock chip, default true
  more?: number;               // >0 renders a "+N" overlay (last cell of a grid)
}
```

- **Anatomy:** `border 1px`, `radius`, `overflow hidden`. Lock chip = 22px circle,
  `rgba(9,30,66,0.62)` + blur, white `lock` 12, bottom-left inset 7.
- **States:** hover dims image to `brightness(0.94)`. `more` overlay =
  `rgba(9,30,66,0.58)` with white `+N` (22·600).
- **Done when:** images crop cleanly; lock chip legible on any image; +N overlay
  centred.

### 3.2 ImageGrid

Tiles 1–N attached photos in a message.

```ts
interface ImageGridProps {
  images: string[];            // decrypted blob URLs
  onOpen: (index: number) => void;
  max?: number;                // default 4 visible cells
  width?: number;              // default 320
}
```

- **Layout rules:**
    - **1:** single image, `max-width width`, natural aspect, `max-height 260`,
    `radius md`, with a "🔒 Encrypted" pill bottom-left.
    - **2:** two equal columns, `gap 3`, each cell `height 116` cover.
    - **3:** first cell spans full width (`height 150`), two equal cells below
    (`height 116`).
    - **4:** 2×2 grid, cells `height 116`.
    - **>max:** last visible cell shows `+ (images.length − max)` overlay.
- **Behaviour:** each cell calls `onOpen(index)`.
- **Done when:** every count 1–5+ matches the layout table; `gap` constant 3;
  taps open the correct index.

### 3.3 Lightbox

Full-screen encrypted image viewer.

```ts
interface LightboxProps {
  src: string;
  name?: string;               // filename, default "image.png"
  onClose: () => void;
}
```

- **Anatomy:** fixed overlay `z 300`, scrim `rgba(9,30,66,0.82)`. Top bar: `image`
  glyph + filename + green **"Encrypted"** Lozenge + spacer + action buttons
  (`download`, `folder-plus` save-to-Vault, `x` close). Centre: image
  `max-width 92% · max-height 100%`, `radius md`, drop shadow.
- **Behaviour:** Esc + scrim-click close; image-click does not close; focus
  trapped; restore focus to trigger.
- **Done when:** opens/closes via Esc & scrim; actions reachable by keyboard;
  large images letterbox without overflow.

### 3.4 ModelImage

An image the model generated, with provenance + actions.

```ts
interface ModelImageProps {
  src?: string;                       // required unless generating
  prompt?: string;                    // echoed prompt
  state?: 'done'|'generating';        // default 'done'
  tag?: string;                       // provenance lozenge text: 'SWISS CLOUD' | 'ON-PREM' | 'THIS DEVICE'
  tone?: 'blue'|'green'|'purple';     // lozenge tone matching tag (cloud=blue, on-prem=green, device=purple)
  host?: string;                      // e.g. "Swiss cloud" (generating caption)
  width?: number;                     // default 380
  onOpen?: () => void;                // open Lightbox
}
```

- **Anatomy (done):** image `radius md`, `border 1px`, click → Lightbox. Below:
  provenance `Lozenge` (tone per tag) + caption "Generated · re-encrypted on
  return". Optional prompt echo in a sunken `radius sm` box. Action row:
  `IconButton` download / regenerate (`refresh-cw`) / variations (`copy-plus`),
  spacer, **Save to Vault** subtle button (`folder-plus`).
- **Generating state:** `height 240` sunken placeholder, diagonal shimmer sweep,
  centred `sparkles` + "Generating on {host}…". No actions shown.
- **Provenance is required** — every generated image must state where compute ran
  (matches the base model-tag convention: ON-PREM green / SWISS CLOUD blue / THIS
  DEVICE purple).
- **Done when:** generating → done transition swaps placeholder for image +
  actions; lozenge tone matches tag; Save-to-Vault emits a Toast.

### 3.5 Composer staging tray

The composer's attachment tray — staged images + documents shown above the input
**before** send. (Extends the base `Composer`; not a standalone export.)

- **Anatomy:** inside the composer's `2px` focused frame, a wrapping row above the
  textarea: image thumbs = 56×56 `radius sm` cover, with a top-right × remove
  (dark circle) and a bottom-left lock chip; documents = `AttachChip`.
- **Caption (replaces/augments the e2e caption):** "{N} attachment{s} sealed on
  this device before send".
- **Behaviour:** each item removable; tray hidden when empty; attaching from Vault
  inserts `AttachChip`s flagged as already-sealed.
- **Done when:** mixed images/docs wrap correctly; removing updates the count;
  encrypting items show `loader`, not lock.

---

## 4. The Vault

The Vault is a person's **encrypted file store**, personal to them, referenced
across chats. Upload once; the model may draw on a file in any conversation; the
ciphertext never leaves the user's control.

### 4.1 Data model

```ts
interface VaultFile {
  id: string;
  name: string;                        // incl. extension
  ext: string;
  size: string;                        // human, e.g. "1.2 MB"
  meta: string;                        // "PDF · 9 pages" | "412 rows" | "3024 × 4032" | "Audio · 3:12"
  kind: 'doc'|'image'|'sheet'|'audio'; // drives the type filter
  refs: number;                        // count of chats referencing this file
  when: string;                        // relative added time, e.g. "2 weeks ago"
  img?: string;                        // decrypted thumbnail blob URL (images only)
}
```

> `refs` is the cross-chat reference count — the product's core Vault concept.
> It must be derived from real reference records, not stored loosely.

### 4.2 VaultCard (grid tile)

```ts
interface VaultCardProps {
  file: VaultFile;
  selectable?: boolean;                // picker mode
  selected?: boolean;
  onToggle?: () => void;               // selectable mode click
  onClick?: () => void;                // normal mode click (open)
  onMore?: () => void;                 // overflow menu
}
```

- **Anatomy:** `radius md`, `border 1px`, `padding 13`, `min-height 124`,
  vertical layout, `gap 11`. Top row: `FileBadge 40` (or 40px image thumbnail for
  `kind:image`) + overflow `more-horizontal` (hover) **or** selection circle
  (selectable). Body: name (2-line clamp, `body`/13.5·600) + "size · meta". Footer
  (top-bordered): reference line — `link` glyph + "In {refs} chats" in
  `--cog-link` (or "Not referenced", subtlest) + green `lock`.
- **States:** hover → border `--cog-border-bold` + `shadow-raised`. selected →
  border `--cog-selected-border`, bg `--cog-selected-bg`, selection circle filled
  `--cog-brand` + white check; footer top-border becomes transparent.
- **Done when:** grid/selected/hover states correct; reference line links to the
  referencing chats; image kind shows a thumbnail not a badge.

### 4.3 VaultListRow (dense list)

```ts
interface VaultListRowProps {
  file: VaultFile;
  top?: boolean;                       // draws a top divider (all but first)
  onClick?: () => void;
  onMore?: () => void;
}
```

- **Anatomy:** `padding 11px 13px`, `gap 13`. Badge/thumb 34 + name (ellipsis) +
  "size · meta · when" + reference count ("{refs} chats" or "—") + green `lock` +
  overflow `IconButton`. Hover bg `--cog-surface-hover`.
- **Done when:** rows divide with 1px lines; everything ellipsises; parity with
  card data.

### 4.4 StorageMeter

Encrypted usage by file type.

```ts
interface StorageMeterProps { width?: number|string; }
```

- **Anatomy:** `radius md` card. Header: `hard-drive` + "VAULT STORAGE" overline +
  "**{used}** of {total}". Stacked bar `height 8` pill, segments coloured by type
  using `--cog-loz-{tone}-fg` (documents=blue, images=purple, sheets=green,
  audio=red), `gap 2`. Legend chips below + "Encrypted on this device" note.
- **Done when:** segment widths sum to used/total proportion; legend matches
  segment colours; both themes legible.

### 4.5 FilterChips

```ts
interface FilterChipsProps {
  value: 'all'|'doc'|'image'|'sheet'|'audio';
  onChange: (v: string) => void;
}
```

- **Anatomy:** pill buttons `height 30`, `radius pill`, `border 1px`. Selected →
  border `--cog-selected-border`, bg `--cog-selected-bg`, text
  `--cog-selected-text` 600. Options: All · Documents · Images · Sheets · Audio.
- **Done when:** single-select; filters the visible set by `kind`.

### 4.6 VaultPage

The assembled Vault screen.

```ts
interface VaultPageProps { empty?: boolean; }
```

- **Header:** Breadcrumbs `Cognos / Vault`; 40px `folder-lock` tile + title
  "Vault" (`heading.lg`) + "{count} files · personal to you" + green "Encrypted"
  Lozenge + **Add files** primary button (`upload`).
- **Toolbar:** `TextField` search ("Search the Vault", `search` icon) +
  `FilterChips` + spacer + grid/list `Seg` toggle (`layout-grid`/`list`).
- **Body:** `StorageMeter` (full width) then a responsive **grid**
  (`minmax(190px,1fr)`, `gap 12`) of `VaultCard`, or the **list** of
  `VaultListRow`. Search filters by name; chips filter by kind (compose both).
- **Empty (`empty`):** centred — 56px `folder-lock` tile, "Your Vault is empty",
  plain-language explainer, then a `Dropzone`.
- **Done when:** search + filter + view-toggle all work and compose; empty state
  routes into the dropzone; layout reflows from ~360px wide upward.

### 4.7 VaultPicker (attach-from-Vault)

Modal to reference Vault files in a chat. Below 600px viewport it renders as a
`full` Sheet (base Modal→Sheet rule).

```ts
interface VaultPickerProps {
  onClose: () => void;
  onAttach?: (ids: string[]) => void;
  initialSelected?: string[];
}
```

- **Anatomy:** `Modal width 520`, title "Attach from your Vault". Intro line
  (decrypt-on-demand explainer) + search `TextField` + a bordered scroll list
  (`max-height 320`) of selectable rows: 20px square checkbox (`radius xs`,
  filled `--cog-brand` + white check when on) + badge/thumb 30 + name + "size ·
  meta" + green `lock`; selected row bg `--cog-selected-bg`. Footer: "{N}
  selected" + Cancel + primary **Attach {N}** (`paperclip`).
- **Behaviour:** multi-select toggle; search filters; Attach emits selected ids +
  closes; Esc/scrim cancel.
- **Done when:** selection state persists across search; count + button label
  update live; attach returns the right ids.

### 4.8 ConfirmShred (crypto-shred)

Irreversible destructive dialog. **This is the privacy-first replacement for a
normal delete.**

```ts
interface ConfirmShredProps {
  file: VaultFile;
  onClose: () => void;
  onConfirm?: () => void;
}
```

- **Anatomy:** `Modal width 460`, no default title row. Red circle (40) with
  `shield-x` (`--cog-loz-red-{bg|fg}`) + heading "Shred this file?" + body: destroys
  the encryption key for **{name}**; ciphertext can never be opened again — not by
  the user, not by anyone it was shared with, not by Cognos. A `DocAttachment`
  preview of the file. If `refs > 0`, an info `SectionMessage`: those messages keep
  their text but the file behind them becomes unrecoverable.
- **Footer:** Cancel (subtle) + **Shred permanently** (`danger`, `shield-x`).
- **Behaviour:** `onConfirm` performs the key destruction then closes; emit a
  danger Toast ("File shredded — the key was destroyed").
- **Done when:** copy makes irreversibility unmistakable; danger styling; refs
  warning only when `refs>0`.

---

## 5. Conversation & system

### 5.1 CodeBlock

```ts
interface CodeBlockProps {
  code: string;
  lang?: string;               // label only, default 'text'
  width?: number;              // default 480
}
```

- **Anatomy:** `radius sm`, `border 1px`, sunken body. Header (`--cog-surface`,
  bottom border): monospace `lang` label + **Copy** button (→ green "Copied" +
  `check` for ~1.4s). Body: `<pre><code>`, monospace 12.5 / line-height 1.65,
  `padding 13px 14px`, horizontal scroll, no wrap.
- **Behaviour:** copy uses the Clipboard API; revert label after 1.4s.
- **Done when:** copy works; long lines scroll, don't wrap; both themes legible.

### 5.2 SourceCard

A Vault file the model cited.

```ts
interface SourceCardProps {
  file: VaultFile;
  locator?: string;            // "p. 4" | "rows 18–24"
  quote?: string;              // verbatim snippet (rendered in quotes)
  onClick?: () => void;        // open the file at the locator
}
```

- **Anatomy:** `radius sm`, `border 1px`, badge/thumb 30 + name (600) + monospace
  locator + optional quote (`body.sm`, left rule `2px --cog-border`) + green
  `lock`. Hover raises border.
- **Done when:** opens source at locator; quote renders with quotation marks;
  always shows the lock.

### 5.3 SourcesRow

Collapsible "N sources from your Vault" under an assistant message.

```ts
interface SourcesRowProps {
  sources: { file: VaultFile; locator?: string; quote?: string }[];
  defaultOpen?: boolean;
}
```

- **Anatomy:** trigger = `quote` glyph + "{n} source(s) from your Vault" +
  chevron, in `--cog-link`. Expands to a stack of `SourceCard` (`gap 8`).
- **Done when:** toggles; pluralises; collapsed by default unless `defaultOpen`.

### 5.4 VaultRefChip

Shows which Vault files a chat/composer is actively drawing on.

```ts
interface VaultRefChipProps {
  files: VaultFile[];
  onClear?: () => void;        // trailing × clears references
  expandable?: boolean;        // multi-file: click to expand a popover list
}
```

- **Anatomy:** pill `height 30`, `radius pill`, border `--cog-selected-border`, bg
  `--cog-selected-bg`, `folder-lock` glyph + label. **1 file** → shows the
  filename. **>1** → "Using {n} files from your Vault" + chevron; click opens an
  upward popover (`shadow-overlay`) listing each file (badge + name + lock).
  Optional × clear.
- **Done when:** single vs multi labelling correct; popover opens above the chip
  and dismisses on outside click; clear fires `onClear`.

### 5.5 Toast (`ToastProvider` / `useToast` / `ToastHost`)

Transient bottom-centre confirmation. Mount **one** `ToastProvider` near the app
root; call `useToast()` to get `notify`.

```ts
type ToastTone = 'success'|'info'|'danger';
interface ToastInput {
  title: string;
  msg?: string;
  tone?: ToastTone;            // default 'success'
  icon?: string;               // Lucide name; defaults: success→shield-check, info→link/info, danger→shield-x
  action?: { label: string; onClick?: () => void };   // e.g. "Undo"
  duration?: number;           // ms, default 3400
}
const notify = useToast();     // notify(input: ToastInput): void
```

- **Anatomy:** `ToastHost` fixed bottom-centre, `z 400`, stack `gap 10`. Each toast:
  `radius md`, `shadow-overlay`, `border 1px`, `min-width 300 · max-width 420`.
  Leading 28px tone circle (`--cog-{tone}-bg` + `--cog-{tone}-text`), title
  (`body.sm`·600) + optional msg + optional action link (`--cog-link`) + × dismiss.
  Enter animation 180ms (`prefers-reduced-motion`: none).
- **Behaviour:** auto-dismiss after `duration`; manual dismiss; action fires then
  dismisses; toasts queue/stack. `pointer-events:none` on the host, `auto` on each
  toast.
- **Done when:** all tones render; auto + manual dismiss; action works; stacking
  ordered newest-at-bottom.

---

## 6. Theming & verification

- **Themes/accents:** every component must be verified in the matrix
  `{light, dark} × {emerald, blue}`. No raw hex; no component-local colour logic
  beyond resolving lozenge tones (§1.5) through tokens.
- **Typeface:** components read `--cog-font`; never hard-code a family. The host
  swaps the variable (System / Atkinson Hyperlegible / Inter / Noto Sans).
- **Responsive:** message-embedded components cap width (cards ≤ ~320, model image
  ≤ 380) and never overflow the bubble. Modals → Sheets below 600px.
- **Reduced motion:** shimmer, progress sweep, and toast entrance all degrade to
  static states.

## 7. Definition of done (per component)

A component ships only when:

1. Props match the interface above; required props validated.
2. All listed states render correctly in the full theme/accent matrix.
3. The encryption state machine (§1.1) is honoured — **no optimistic lock**;
   plaintext/keys never leave the device; previews are revocable blob URLs.
4. Keyboard + screen-reader operable; focus ring; Esc/scrim on overlays; ≥44px
   touch targets.
5. Reduced-motion path verified.
6. No console errors; matches the reference build in `cognos/Cognos Components.html`.

---

*Cognos Design System · Component Extension v1 — extends the Atlassian / Emerald
build. Pair with `README.md` (base components) and `tokens.css` (the colour
contract).*
