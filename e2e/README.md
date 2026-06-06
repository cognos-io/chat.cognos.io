# @cognos/e2e

End-to-end tests for chat.cognos.io powered by [Playwright](https://playwright.dev/).

## Prerequisites

1. **Playwright browsers installed** (one-time):

   ```sh
   pnpm --filter @cognos/e2e exec playwright install --with-deps
   ```

## Running

Playwright auto-starts a local mock AI provider, the backend API, and `ng serve`
on `http://localhost:4200` before the suite:

```sh
pnpm --filter @cognos/e2e test           # headless
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
created users are **not** cleaned up automatically — clear them from the
PocketBase admin UI or wipe `backend/pb_data` when the dev database gets noisy.
