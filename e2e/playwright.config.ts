import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4200';
const POCKETBASE_URL = process.env.E2E_POCKETBASE_URL ?? 'http://localhost:8090';
const AI_MOCK_URL = process.env.E2E_AI_MOCK_URL ?? 'http://127.0.0.1:18080/v1';
const AI_MOCK_HEALTH_URL =
  process.env.E2E_AI_MOCK_HEALTH_URL ?? 'http://127.0.0.1:18080/health';

// Set to `1` to skip auto-starting local services (e.g. when targeting
// a deployed environment via E2E_BASE_URL).
const SKIP_WEB_SERVER = process.env.E2E_SKIP_WEB_SERVER === '1';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: process.env.CI ? [['github'], ['html']] : 'html',
  use: {
    baseURL: BASE_URL,
    // The local dev stack serves the frontend over HTTPS with a self-signed
    // cert (cognos.local). Harmless against plain-http (CI) targets.
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
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
          command: 'pnpm --filter @cognos/chat start --host 127.0.0.1 --port 4200',
          cwd: '..',
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 120_000,
        },
      ],
  metadata: {
    pocketbaseUrl: POCKETBASE_URL,
  },
});
