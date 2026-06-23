# Cognos

This is the monorepo for [cognos.io](https://cognos.io/), an AI chat application like ChatGPT that
encrypts user messages server side that can only be decrypted by the user. This is a similar
approach to ProtonMail which encrypts user emails.

## Project structure

- `backend/` the Go API. Powered by Pocketbase,
- `frontend/` an Angular v21 application. The chat interface that decrypts messages, sends to the
  backend etc.
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

## Tools

| Use ✅        | Do not use ❌                    |
| ------------- | -------------------------------- |
| `uv`          | `pip` `pipenv` etc               |
| `just`        | `make`                           |
| `podman`      | `docker`                         |
| `dragonflydb` | `redis`                          |
| `ty`          | `mypy` `pyright`                 |
| `pnpm`        | `npm` `yarn` `bun`               |
| `paddle`      | `stripe` `polar` `lemon squeezy` |
| `http`        | `curl` `wget`                    |
| `uv run`      | `python3` `python`               |
| `mise`        | `nvm` `gvm` `asdf` etc           |

## Testing

Tests should cover sunny, rainy and edge cases including invalid data gets handled correctly
and behaviour is expected.

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
- `just e2e` runs the full suite (browser + API) on the default ports `4200`/`8090`. The browser
  specs need those exact ports because the dev frontend build hard-codes the backend URL, so **stop
  `just dev` first** or you'll hit port conflicts.
- Both auto-start their own backend + mock AI provider; you don't need `just dev` running.

### Data access

It's important to write tests so that users cannot access unauthorised data. They can only have
access to the data they are allowed (either as the owner or a team/organisation etc.).

See `@backend/cmd/api/filter_rules_test.go` for examples of how this is done with Pocketbase.
