import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4200';
const POCKETBASE_URL = process.env.E2E_POCKETBASE_URL ?? 'http://localhost:8090';
// Base URL only — the bifrost OpenAI-compatible client appends its own
// `/v1/chat/completions`, so a trailing `/v1` here would double it to
// `/v1/v1/chat/completions` and 404 against the mock.
const AI_MOCK_URL = process.env.E2E_AI_MOCK_URL ?? 'http://127.0.0.1:18080';
const AI_MOCK_HEALTH_URL =
  process.env.E2E_AI_MOCK_HEALTH_URL ?? 'http://127.0.0.1:18080/health';

// Set to `1` to skip auto-starting local services (e.g. when targeting
// a deployed environment via E2E_BASE_URL).
const SKIP_WEB_SERVER = process.env.E2E_SKIP_WEB_SERVER === '1';

// Set to `1` to skip the frontend dev server — the API specs only need the
// backend + mock, so the API-only target runs without it (and on its own
// ports) to avoid clashing with a running `just dev` stack.
const SKIP_FRONTEND = process.env.E2E_SKIP_FRONTEND === '1';

// The backend binds and stores data wherever these point. Defaults match the
// dev stack so CI and the full suite are unchanged; the API-only target
// overrides them to a separate port + data dir so it can run alongside `just dev`.
const POCKETBASE_HOST = new URL(POCKETBASE_URL).host;
const POCKETBASE_DIR = process.env.E2E_POCKETBASE_DIR ?? './pb_data';

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
                // Requesty hosts the image models; point it at the mock so image
                // generation works offline (the mock serves both transports).
                'COGNOS_REQUESTY_API_KEY=e2e-dummy-key',
                `COGNOS_REQUESTY_URL=${AI_MOCK_URL}`,
                `go run ./cmd/api serve --dev --dir ${POCKETBASE_DIR} --http=${POCKETBASE_HOST}`,
              ].join(' '),
            ),
          cwd: '../backend',
          url: `${POCKETBASE_URL}/health`,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 120_000,
        },
        // The frontend dev server is only needed for browser specs; the API
        // specs skip it (E2E_SKIP_FRONTEND=1) so they can run on isolated ports.
        ...(SKIP_FRONTEND
          ? []
          : [
              {
                command:
                  'pnpm --filter @cognos/chat start --host 127.0.0.1 --port 4200',
                cwd: '..',
                url: BASE_URL,
                reuseExistingServer: !process.env.CI,
                stdout: 'pipe' as const,
                stderr: 'pipe' as const,
                timeout: 120_000,
              },
            ]),
      ],
  metadata: {
    pocketbaseUrl: POCKETBASE_URL,
  },
});
