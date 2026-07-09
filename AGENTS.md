# Cognos

This is the monorepo for [cognos.io](https://cognos.io/), an AI chat application like ChatGPT that
encrypts Messages server-side so only the Account holder can decrypt them — similar in spirit to
ProtonMail for email.

**Domain language:** see [`CONTEXT.md`](./CONTEXT.md) for canonical terms — use it when writing
specs, docs, or user-facing copy so we stay consistent (e.g. Account vs User, Account Key).
[`docs/business_processes/`](./docs/business_processes/) and [`docs/specs/`](./docs/specs/) follow
that glossary in domain prose (code identifiers such as `user_id` stay unchanged).

## Claude Orchestration workflow

**Important**: If you are not Claude or Fable, skip this section.

You (Fable) are the orchestrator. Plan, decompose, synthesize. Reasoning-heavy phases use
@deep-reasoner. Mechanical work use @fast-worker. High-stakes decisions: task Opus + Codex on the
same problem in parallel, synthesize the best of both, without showing either the other's answer.
Keep your own context lean and focused. Project manage, delegate effectively and orchestrate. Gather
knowledge because that is how you can make the best decisions.

## Project structure

- `backend/` the Go API. Powered by Pocketbase,
- `frontend/` an Angular v21 application. The chat interface that decrypts messages, sends to the
  backend etc.
- `packages/ui-angular/` the shared Angular component library (`@cognos/ui-angular`). **Before
  building frontend UI, check `packages/ui-angular/COMPONENTS.md`** for an existing component to
  reuse; extract a new one there when a UI pattern repeats more than twice.
- `web/` marketing pages in Astro

## Guidelines

- Write browser and api e2e tests first. Red/green development. More info below.
- Security is a top priority. We must make sure that we never log user data including chat contents.
  Chats must be encrypted as soon as possible.
- Simple is secure. Keep things idomatic. Prefer declarative over imperative.
- Use Dash docs skill if need to look up Pocketbase or Angular documentation as they are releasing
  new features which changes the overall behaviour and syntax at times
- When scaffolding, run the relevant commands don't just write files. For example, run `pnpm init`
  and NOT just write a `package.json` file. Use the `ng` CLI via `pnpm` to scaffold angular services
  and components etc.
- routinely start with the high level e2e tests. write unit tests for logic and hot paths for
  robustness.
- high level e2e tests use playwright in `e2e/` and test broader functionality rather than specific
  css classes etc.
- keep any relevant spec and checklist updated as working through.
- regularly run the frontend and backend build, tests, linting and formatting and make sure to fix
  anything that comes up
- (you can also be proactive and fix something you haven't done but make it a separate commit)
- prefer small conventional commits with a helpful title and very short description when working on
  larger tasks as code will be reviewed commit-by-commit
- ask clarifying questions. minimise assumptions. use the decision maker skill for fast decisions
  but ask if that also is unsure.
- Write and maintain documentation for humans with poor attention spans.
- Use i18n and make sure all translations are provided in all supported languages and not just
  English.
- Use `packages/ui` design tokens (`--cog-*`) for UI colour, spacing, type, radius, shadow and
  motion; avoid hard-coded visual values in `packages/ui-angular`, `frontend` and `web`.

## Internationalisation (i18n)

We ship the same six languages everywhere. Provide every translation in all six — never
English-only. Cognos is a **Swiss company serving a European audience**, so always translate to the
**European regional variant**, not the Latin-American / Brazilian / US one:

| Code | Locale                        | Watch out for                                                                            |
| ---- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `en` | English (British, en-GB)      | `-ise`/`colour`/`organisation`, not US spellings                                         |
| `de` | Swiss Standard German (de-CH) | Use **`ss`, never `ß`** (Swiss orthography); informal **du**                             |
| `fr` | French (fr-CH / standard)     | Polite **vous** in marketing copy                                                        |
| `es` | European Spanish (es-ES)      | `ordenador`/`móvil` (not `computadora`/`celular`); informal **tú**                       |
| `pt` | European Portuguese (pt-PT)   | `ecrã`/`palavra-passe`/`anónimo`/`contacto`/`dispositivo`; informal **tu**, **not você** |
| `it` | Italian (it-CH / standard)    | Informal **tu**                                                                          |

- The catalogue registry is `frontend/src/app/i18n/languages.ts`; keep it and every locale file in
  sync. Frontend catalogs live in `frontend/src/assets/i18n/<code>.json`; the marketing site's in
  `web/src/i18n/locales/<code>.json`.
- Keep the JSON key structure **identical** across all locales, and preserve inline `<b>` markup and
  `{{ var }}` interpolation placeholders untouched.
- Marketing copy in `web/` is plain-language and privacy-first: write for non-technical readers, and
  **never** use "end-to-end", "zero-knowledge", "ciphertext"/"plaintext" or similar jargon. Keep
  every privacy claim aligned with `docs/security-model.md` (e.g. "we keep no copy we can read",
  "kept in Switzerland or Europe" — not "the data never leaves your device").

## Tools

| Use ✅                          | Do not use ❌                    |
| ------------------------------- | -------------------------------- |
| `uv`                            | `pip` `pipenv` etc               |
| `just`                          | `make`                           |
| `podman`                        | `docker`                         |
| `dragonflydb`                   | `redis`                          |
| `ty`                            | `mypy` `pyright`                 |
| `pnpm`                          | `npm` `yarn` `bun`               |
| `paddle`                        | `stripe` `polar` `lemon squeezy` |
| `http`                          | `curl` `wget`                    |
| `uv run`                        | `python3` `python`               |
| `mise`                          | `nvm` `gvm` `asdf` etc           |
| `rumdl` for markdown formatting | `prettier`                       |

## Testing

Tests should cover sunny, rainy and edge cases including invalid data gets handled correctly
and behaviour is expected.

Some tests "pin" behaviour: they assert what the code **currently does** (a quirk, default, or
wire contract we depend on) rather than what anyone designed. If a pin test fails after an
intentional change, update the test deliberately — it exists to make behaviour changes
conscious, never accidental. Write pin comments so the reader knows why the current behaviour
was kept.

When testing locally, run the backend, frontend and web on non-standard ports so as not to conflict
with other development ports.

- Unit tests for hot and critical code paths
- Red/green tests wherever possible
- Write browser e2e tests with playwright, API e2e tests with playwright, Go test tables, Typescript
  vitest test tables for frontend

### Running e2e without clobbering a live dev stack

- `just e2e-api` runs the **API** e2e specs (`e2e/tests/*-api.spec.ts`) on isolated ports
  (PocketBase `8095`, mock AI `18085`) and a separate data dir (`backend/testdata/pb_data`), so they
  run cleanly alongside a running `just dev` (which holds `4200`/`8090`). Prefer this for API tests.
- `just e2e` runs the full suite (browser + API) on the same isolated HTTPS E2E stack. Browser specs
  use a production-style frontend build served by PocketBase, not Angular's live dev server.
- Both auto-start their own backend + mock AI provider; you don't need `just dev` running.

### Data access

It's important to write tests so that users cannot access unauthorised data. They can only have
access to the data they are allowed (either as the owner or a team/organisation etc.).

See `@backend/cmd/api/filter_rules_test.go` for examples of how this is done with Pocketbase.

`@docs/api-permissions.md` is the map of every `/api/v1` endpoint's auth + scope rule and the
test that enforces it, plus the checklist for adding a new endpoint (authorize, register in the
auth-surface guardrail, add a cross-user denial test). Keep it current when adding endpoints.
