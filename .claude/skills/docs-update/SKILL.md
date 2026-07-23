---
name: docs-update
description: Keep the Cognos user documentation site (the /docs knowledge base in web/) in sync when a feature ships or its user-facing behaviour changes. Updates the English article(s), captures cropped app screenshots, adversarially fact-checks with omp, and re-translates into all six languages (de, fr, es, pt, it). Use when a feature is added/changed, when asked to "update the docs", "document this feature", "add a docs page", or when docs drift from the app. NOT for the marketing homepage or legal/privacy pages.
---

# docs-update

Keep `/docs` (the end-user knowledge base in `web/`) accurate as the product
changes. Content is data-driven i18n JSON, not markup — you edit content +
screenshots, and reproducible scripts + subagents do the mechanical work.

**Read [references/architecture.md](references/architecture.md) before editing** —
it has the block-model schema, where everything lives, the figure rules, the
locale contract, and the voice/accuracy rules. All paths below are repo-relative.

## The update loop

### 1. Scope the change
Find the affected article(s): nav lives in `web/src/lib/docs.ts` (`docGroups`),
content under `docs.pages.<slug>` in `web/src/i18n/locales/en.json`. Decide:
edit an existing article, or add a new slug.

To learn the real behaviour without bloating context, spawn an **Explore
subagent** over `docs/business_processes/` + `frontend/` and ask for conclusions
only. **Never document unshipped/planned/backend-only behaviour** — cross-check
`docs/open-points.md`.

### 2. Edit the English content
Author blocks per the schema in the architecture reference. Follow `CONTEXT.md`
vocabulary and the web/ tone (plain language; no "end-to-end"/"zero-knowledge"/
"ciphertext"). Bump the page's `updated` date.

Apply so only the `docs` block changes (tight diffs; Prettier normalises on commit):
```
# write the changed/new page object(s) to a patch file, then:
python3 .claude/skills/docs-update/scripts/docs_tool.py apply en /tmp/patch.json
```
Patch shape: `{"pages": {"<slug>": { …full page… }}}` (a slug replaces that whole
page); `nav`/`meta`/`home` keys merge. For a **new article**, first add its slug
to `docGroups` in `web/src/lib/docs.ts` (pick the group + position), then apply the page.

### 3. Adversarially fact-check (free — do it before committing)
```
~/.claude/skills/omp/scripts/omp_run.sh --preset read-only --cwd "$PWD" --max-time 600 \
  "Fact-check this docs article against how Cognos works. Article: <paste/point>. \
   Ground truth (read-only): CONTEXT.md, docs/business_processes/, docs/open-points.md. \
   Flag inaccuracies, over-promises (unshipped features), and vocabulary drift. Concise, quote snippets."
```
Run it in the background (it exceeds the 2-min shell timeout) and apply the findings.

### 4. Screenshots (only if the UI changed)
Re-capture with the committed, re-runnable script (app must be running via
`just dev`; needs a verified test account — see the script's header comment):
```
COGNOS_TEST_EMAIL=… COGNOS_TEST_PASSWORD=… COGNOS_TEST_ACCOUNT_KEY=… \
  node web/scripts/capture-docs-screenshots.mjs [en de fr es pt it]
```
Add `figure` blocks referencing `/docs-media/<name>.png` (they hide until the PNG
exists). For a **new** screenshot, add a capture step to that script so it stays
reproducible; localised shots need a language-agnostic selector (see the script).

### 5. Translate (after English is final)
Delegate to subagents — see [references/translation.md](references/translation.md)
for the exact prompt template and variant rules:
```
python3 .claude/skills/docs-update/scripts/docs_tool.py extract en -o /tmp/docs_en.json
# spawn one fast-worker per locale → /tmp/<lang>.json, then:
python3 .claude/skills/docs-update/scripts/docs_tool.py replace <lang> /tmp/<lang>.json
```
`replace` refuses on a key-tree mismatch. For a tiny English change, translate the
few strings yourself instead (keep key trees identical).

### 6. Verify + commit
```
cd web && pnpm build && pnpm test
python3 ../.claude/skills/docs-update/scripts/docs_tool.py check   # parity + figure coverage
```
Commit in small conventional commits (`docs(web): …`). Stage only docs files.

## scripts/docs_tool.py

One tool, four subcommands (repo found via `COGNOS_REPO` or relative to the file):
- `extract <lang> [-o FILE]` — dump a locale's `docs` object (feed en to translators).
- `apply <lang> <patch.json>` — deep-merge an English content patch.
- `replace <lang> <docs.json>` — swap the whole `docs` block (translations), parity-checked vs en.
- `check` — locale parity, articles with no figure, missing figure files, localised-shot counts. Exit non-zero on parity drift.

## Known gaps
- `reasoning` has no screenshot: the dev model catalogue has no reasoning-capable
  model, so the reasoning-effort control never renders. Capture it if run against
  an environment that has one.
- `share-public` (public read-only view) isn't captured — the share dialog already
  shows the redacted-vs-include-sensitive choice.
