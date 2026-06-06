# @cognos/e2e

End-to-end tests for chat.cognos.io powered by [Playwright](https://playwright.dev/).

## Prerequisites

1. **PocketBase backend running** at `http://localhost:8090` (default). From the
   repo root:

   ```sh
   just backend
   ```

   The e2e suite mocks completion responses in the browser, but the backend still
   needs enough configuration to boot with the active Infomaniak model enabled.
   For local runs, dummy `infomaniak.api_key` and `infomaniak.product_id` values
   in `backend/configs/api.local.yaml` are sufficient.

2. **Playwright browsers installed** (one-time):

   ```sh
   pnpm --filter @cognos/e2e exec playwright install --with-deps
   ```

## Running

Playwright auto-starts `ng serve` on `http://localhost:4200` before the suite:

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
