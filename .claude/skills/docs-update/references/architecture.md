# Docs site architecture

The documentation site lives inside the Astro marketing app (`web/`) at `/docs`.
It is data-driven: components render entirely from the i18n catalogues, so
**updating docs = editing content + screenshots**, not writing markup.

## Where things live

| Thing                                        | Path                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| Nav tree (groups → page slugs, order, icons) | `web/src/lib/docs.ts` (`docGroups`)                                          |
| Page content (all locales)                   | `web/src/i18n/locales/<lang>.json` under the `docs` key                      |
| Components (don't usually touch)             | `web/src/components/DocsPage.astro`, `DocsSidebar.astro`, `DocsBlock.astro`  |
| Styles (all `--cog-*` tokens)                | `web/src/styles/docs.css`                                                    |
| Routes                                       | `web/src/pages/docs/[slug].astro`, `web/src/pages/[lang]/docs/[slug].astro`  |
| Screenshots                                  | `web/public/docs-media/*.png` (en) and `docs-media/<lang>/*.png` (localised) |
| Screenshot capture script                    | `web/scripts/capture-docs-screenshots.mjs`                                   |

`docGroups` and `docSlugs` in `docs.ts` are the single ordering source (sidebar,
prev/next). Every slug **must** have a `docs.pages.<slug>` entry in `en.json`.

## Content model (`docs` catalogue shape)

```text
docs:
  meta: { …chrome labels… }        # rarely changes
  nav:  { <groupId>: "Group label" }
  home: { metaTitle, metaDescription, title, lead, sections:[…] }   # hub cards
  pages:
    <slug>:
      navTitle, metaTitle, metaDescription, title, lead
      updated: "22 July 2026"      # bump when you change the page
      time?: "3 min read"          # optional
      needs?: ["…"]                # optional "Before you start" list
      sections: [ { heading, blocks: [ …block… ] } ]
      related?: ["other-slug", …]  # cards at the foot
```

### Block types (a section's `blocks[]`)

```text
{ "p": "prose, trusted inline <b>/<a href>/<code> HTML" }
{ "h3": "sub-heading" }
{ "ul": ["item", …] }
{ "steps": [ { "title": "…", "body"?: "…" }, … ] }        # numbered how-to
{ "note": { "variant"?: "tip|info|warning|security", "title"?: "…", "body": "…" } }
{ "figure": { "src": "/docs-media/<name>.png", "alt": "…", "caption"?: "…" } }
{ "table": { "head": ["…"], "rows": [["…"], …] } }
{ "cards": [ { "to": "/docs/<slug>", "icon"?: "LucideName", "title": "…", "body": "…" } ] }
```

- Inline links to other docs use root-relative `href="/docs/<slug>"` — `DocsBlock`
  localises them per locale automatically. App deep-links use the full
  `https://app.cognos.io/...` URL. Marketing pages use `/security`, `/privacy`, etc.
- `security` notes are the strongest (data-loss warnings). `warning` for
  footguns, `info` for clarifications, `tip` for helpers.

## Figures

- A `figure` renders only if its PNG exists under `web/public/`; otherwise it is
  silently hidden (build-time check). So it's safe to reference a screenshot
  before capturing it.
- Localised: `DocsBlock` uses `docs-media/<lang>/<name>.png` when present, else
  the English `docs-media/<name>.png`. Capture localised shots with the script's
  language argument.
- `alt` and `caption` are user-visible → translate them in each locale.

## Locale contract

`web/scripts/check-marketing-contracts.mjs` requires every locale's key tree to
match `en.json`. `docs.*` is exempted (English-only is allowed to lag, English
fallback at runtime) via `optionalKeyPrefixes`, but **aim for full parity** —
`docs_tool.py check` reports drift and `replace` refuses a structure mismatch.
Never insert empty arrays (`[]`) into a locale — they block English fallback.

## Voice & accuracy rules

- Vocabulary: follow `CONTEXT.md` (Account, Account Key, Conversation, Participant,
  Privacy tier vs Plan, Organisation, …). "Chat" is acceptable as the everyday
  UI word; use "Conversation" for the entity in precise statements.
- Tone (web/ rule): plain language for non-technical readers. **Never** use
  "end-to-end", "zero-knowledge", "ciphertext"/"plaintext". Say "kept in a form we
  can't read", "handled in Switzerland or Europe".
- **Never document unshipped, planned, or backend-only behaviour.** Cross-check
  `docs/open-points.md` and the relevant `docs/business_processes/*.md`.
- ADHD-friendly: short sections, numbered `steps`, callouts, cross-links.
