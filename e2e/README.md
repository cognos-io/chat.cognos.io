# @cognos/e2e

End-to-end tests for chat.cognos.io powered by [Playwright](https://playwright.dev/).

Domain vocabulary for specs and assertions: [`CONTEXT.md`](../CONTEXT.md).

## Prerequisites

1. **Playwright browsers installed** (one-time):

   ```sh
   pnpm --filter @cognos/e2e exec playwright install --with-deps
   ```

2. **mkcert installed and `cognos.local` resolving locally.** `just e2e` runs the repo's
   `mkcert` recipe, which creates `/tmp/cognos.crt` and `/tmp/cognos.key` when missing.

## Running

Playwright auto-starts a local mock AI provider, builds the frontend, and serves
those assets from PocketBase over HTTPS on `https://cognos.local:8095` before the
suite. The backend uses `backend/testdata/pb_data`, so it does not touch your
local dev database.

```sh
just e2e                                # headless
pnpm --filter @cognos/e2e test:headed    # show the browser
pnpm --filter @cognos/e2e test:ui        # interactive UI mode
pnpm --filter @cognos/e2e report         # open the last HTML report
```

## Targeting a deployed environment

```sh
E2E_BASE_URL=https://chat.cognos.io \
E2E_POCKETBASE_URL=https://api.cognos.io \
E2E_SKIP_WEB_SERVER=1 \
pnpm --filter @cognos/e2e test
```

## Notes on test data

Each test run generates a unique email address (e.g. `e2e-1717590000000-x7k2@cognos-e2e.test`),
so the suite is safe to run repeatedly against the same PocketBase instance. The
created users are **not** cleaned up automatically — wipe `backend/testdata/pb_data`
when the E2E database gets noisy.
