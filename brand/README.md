# Brand assets

**This folder is the source of truth.** Copy out of here into apps — do not invent a second master.

## What's here

| File                               | Use for                           |
| ---------------------------------- | --------------------------------- |
| `cognos-symbol__square--black.svg` | Master — prefer this              |
| `cognos-symbol__square--black.png` | 512×512 raster (from the SVG)     |

Wordmark (horizontal) still lives at
`frontend/src/app/components/cognos-logo/cognos_logo--horizontal.svg` until moved here.

## Naming

`{thing}__{shape}--{colour}.svg`

| Part   | Example         | Means                |
| ------ | --------------- | -------------------- |
| thing  | `cognos-symbol` | Mark only (no word)  |
| shape  | `square`        | 1:1 canvas           |
| colour | `black`         | Fill/stroke baked in |

Need a green or currentColor variant? Add a new file — don't overwrite this one.

## Using an asset (~2 min)

1. Copy from `brand/`
2. Paste into the consumer path below
3. Commit both (source + copy) if the runtime file must ship

| Need                  | Put the copy here                               |
| --------------------- | ----------------------------------------------- |
| Marketing favicon     | `web/public/favicon.svg`                        |
| App favicons          | `frontend/src/favicon*` (PNG/ICO from this SVG) |
| In-app logo component | `frontend/src/app/components/cognos-logo/`      |

## Rules

1. Edit the file in `brand/` first, then refresh copies
2. Prefer SVG over PNG for new work
3. Do not put secrets, screenshots, or one-off mockups here
4. Keep squares square (`viewBox` 1:1)

## Next

Moving the horizontal wordmark into `brand/` with the same naming scheme? Say the word.
