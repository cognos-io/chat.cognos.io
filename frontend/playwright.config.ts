import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4201';
const POCKETBASE_URL = process.env.E2E_POCKETBASE_URL ?? 'http://127.0.0.1:8090';
const AI_MOCK_URL = process.env.E2E_AI_MOCK_URL ?? 'http://127.0.0.1:18080/v1';
const AI_MOCK_HEALTH_URL =
  process.env.E2E_AI_MOCK_HEALTH_URL ?? 'http://127.0.0.1:18080/health';

// Set to `1` to skip auto-starting local services (e.g. when targeting an
// already-running dev stack).
const SKIP_WEB_SERVER = process.env.E2E_SKIP_WEB_SERVER === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: 'line',
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
  ],
  // Self-contained stack so the suite runs in CI as well as locally: the mock
  // AI provider + a dev backend (pointed at the mock) + the Angular dev server.
  // Mirrors the root e2e config so the two suites behave identically.
  webServer: SKIP_WEB_SERVER
    ? undefined
    : [
        {
          command: 'go run ./cmd/mock-ai-provider',
          cwd: '../backend',
          url: AI_MOCK_HEALTH_URL,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 60_000,
        },
        {
          command:
            'sh -c ' +
            JSON.stringify(
              [
                'COGNOS_INFOMANIAK_API_KEY=e2e-dummy-key',
                `COGNOS_INFOMANIAK_URL=${AI_MOCK_URL}`,
                'COGNOS_INFOMANIAK_PRODUCT_ID=e2e-dummy-product',
                'go run ./cmd/api serve --dev --dir ./pb_data',
              ].join(' '),
            ),
          cwd: '../backend',
          url: `${POCKETBASE_URL}/health`,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 120_000,
        },
        {
          command: 'pnpm exec ng serve --host 127.0.0.1 --port 4201',
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
