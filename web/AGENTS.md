# Cognos Web Pages Development

[Astro](https://docs.astro.build) project for Cognos marketing pages.

Domain language: [`CONTEXT.md`](../CONTEXT.md).

## Layout

| Path                                       | What lives there                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `src/pages/`                               | Routes. Each page exists twice: `foo.astro` (English, unprefixed) and `[lang]/foo.astro` (the five prefixed locales). |
| `src/i18n/locales/*.json`                  | All copy, in six locales with an identical key tree.                                                                  |
| `src/lib/`                                 | Content models - `docs.ts`, `blog.ts`, `legal.ts`, `media.ts`.                                                        |
| `src/styles/`                              | `tokens.css` (the `--cog-*` aliases), then one stylesheet per section.                                                |
| `public/docs-media/`, `public/blog-media/` | Screenshots and artwork.                                                                                              |

Content blocks (steps, callouts, figures, tables, cards, galleries) are shared: the `DocsBlock`
union in `src/lib/docs.ts` describes them, `DocsBlock.astro` renders them, and
`src/styles/content-blocks.css` styles them. The docs and the blog both use all three.

## Adding a blog post

1. Add an entry to `posts` in `src/lib/blog.ts` - slug, absolute ISO `date`, `author`, `tags`,
   `icon`, and optionally `hero`. Everything language-independent lives here, so a translator never
   has to keep a date in sync across six files.
2. Add `blog.posts.<slug>` to **all six** locale files with `title`, `metaTitle`,
   `metaDescription`, `lead`, `time`, `heroAlt` and `sections`. `pnpm test` fails if a locale is
   missing a field, if an image has no alt text, or if the copy uses crypto jargon.
3. Put artwork in `public/blog-media/<slug>/`. Images render only once the file exists, so a post
   can ship before its artwork is finished. Localised versions go in
   `public/blog-media/<lang>/<slug>/` and win for that locale.
4. Routes, the index, both feeds and the sitemap follow automatically.

Prefer **text-free artwork**. The same file is served to all six locales, so any words baked into an
image are effectively English-only; let the translated `alt` and `caption` carry the meaning.

Use a `gallery` block for more than one image - it renders as a slideshow and its images open in the
lightbox. `figure` blocks are zoomable only where `DocsBlock` is given `zoomable` (blog posts do,
docs pages do not), and zooming needs `Lightbox.astro` on the page.

## Markdown twins and llms.txt

Every page is also served as plain markdown: append `.md` to any page URL
(`/terms.md`, `/de/docs/account-key.md`, `/index.md` for the homepage). `/llms.txt` indexes them per
[llmstxt.org](https://llmstxt.org/), `/llms-full.txt` concatenates them, and both exist per locale
(`/de/llms.txt`). Each HTML page points at its own twin with
`<link rel="alternate" type="text/markdown">`.

The twins render from the same catalogues as the pages, so a translation lands in both at once.
Three files do the work:

| File                   | Job                                                                 |
| ---------------------- | ------------------------------------------------------------------- |
| `src/lib/markdown.ts`  | Blocks and inline HTML to markdown. Unit tested with `node --test`. |
| `src/lib/md-routes.ts` | One entry per page. **Add a route here when you add a page.**       |
| `src/lib/llms.ts`      | The two index files.                                                |

Docs pages, blog posts and legal pages need nothing but their catalogue key - they already store
content as blocks. The homepage, `/about`, `/business` and `/contact` shape their own keys, so each
has a short hand-written body in `md-routes.ts`; extend it when you add a section to one of them.

`scripts/check-llms.mjs` fails the build if a page in the sitemap has no twin, if a locale is
missing one, if `llms.txt` links somewhere that was not built, or if a twin leaks an untranslated
catalogue key or an HTML tag.

Two conventions to know before editing the serializer:

- Front matter carries the metadata (`title`, `source`, `locale`, `updated`). The field names are
  machine identifiers, so they stay English in all six locales without being untranslated copy.
  Callouts use GitHub alert syntax (`> [!CAUTION]`) for the same reason - the alternative was
  inventing the word "Security" six times.
- In-document links point at the **human** page, not its twin, so an agent quoting us cites a URL a
  person can open. Only `llms.txt` links to `.md` files.

## Checks

All four run in CI, in this order.

- `pnpm check` - `astro check`. Typechecks `.astro` templates, component props and `src/**/*.ts`.
  `astro build` does **not** typecheck, so this is the only thing that catches a bad prop or a
  null-unsafe DOM script.
- `pnpm build`, then `pnpm test` - the `src/lib/*.test.ts` unit tests, analytics guardrails, pricing
  and support-response copy, catalogue-key parity, per-locale blog completeness, and the markdown
  twin / `llms.txt` checks. Run the build first; the analytics and markdown checks read `dist/`.
- `pnpm test:e2e` - Playwright against a production build on port 4321. Includes an axe scan, a
  per-locale rendering check and an assertion that every referenced image actually decodes.

Note that `useTranslations` **falls back to English** for any key a locale is missing. That keeps a
half-translated page readable, but it also means a dropped translation looks like a styling oddity
rather than an error - so locale coverage is asserted in `pnpm test` and pinned per-locale in the
e2e suite. If copy renders in English on a prefixed route, suspect a missing catalogue key first.
