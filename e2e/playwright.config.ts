import { defineConfig, devices } from '@playwright/test';

const DEFAULT_E2E_ORIGIN = 'https://cognos.local:8095';
const POCKETBASE_URL = process.env.E2E_POCKETBASE_URL ?? DEFAULT_E2E_ORIGIN;
const POCKETBASE = new URL(POCKETBASE_URL);
const BASE_URL = process.env.E2E_BASE_URL ?? POCKETBASE_URL;
// Base URL only — the bifrost OpenAI-compatible client appends its own
// `/v1/chat/completions`, so a trailing `/v1` here would double it to
// `/v1/v1/chat/completions` and 404 against the mock.
const AI_MOCK_URL = process.env.E2E_AI_MOCK_URL ?? 'http://127.0.0.1:18085';
const AI_MOCK_HEALTH_URL =
  process.env.E2E_AI_MOCK_HEALTH_URL ?? 'http://127.0.0.1:18085/health';
const AI_MOCK_PORT = new URL(AI_MOCK_URL).port || '18085';

// Set to `1` to skip auto-starting local services (e.g. when targeting
// a deployed environment via E2E_BASE_URL).
const SKIP_WEB_SERVER = process.env.E2E_SKIP_WEB_SERVER === '1';

// Set to `1` to skip building/serving the frontend — the API specs only need
// the backend + mock.
const SKIP_FRONTEND = process.env.E2E_SKIP_FRONTEND === '1';

// The backend binds and stores data wherever these point. Defaults intentionally
// avoid the local dev stack (`4200`/`8090`/`18080` and `backend/pb_data`).
const POCKETBASE_LISTEN_ADDR =
  process.env.E2E_POCKETBASE_LISTEN_ADDR ??
  (POCKETBASE.hostname === 'cognos.local'
    ? `127.0.0.1:${POCKETBASE.port || '443'}`
    : POCKETBASE.host);
const POCKETBASE_LISTEN_FLAG = POCKETBASE.protocol === 'https:' ? 'https' : 'http';
const POCKETBASE_DIR = process.env.E2E_POCKETBASE_DIR ?? './testdata/pb_data';
const FRONTEND_DIST_DIR =
  process.env.E2E_FRONTEND_DIST_DIR ?? '../frontend/dist/browser';
const TLS_CERT = process.env.E2E_TLS_CERT ?? '/tmp/cognos.crt';
const TLS_KEY = process.env.E2E_TLS_KEY ?? '/tmp/cognos.key';
// E2E-only superuser used by the API helpers to mark provisioned users as
// email-verified (AI endpoints require a verified email; the e2e stack has no
// SMTP). Test-only credentials on an isolated data dir — not real secrets.
const E2E_SUPERUSER_EMAIL =
  process.env.E2E_SUPERUSER_EMAIL ?? 'e2e-superuser@example.com';
const E2E_SUPERUSER_PASSWORD =
  process.env.E2E_SUPERUSER_PASSWORD ?? 'e2e-superuser-password-1234'; // gitleaks:allow

const BACKEND_ENV = [
  'COGNOS_INFOMANIAK_API_KEY=e2e-dummy-key',
  `COGNOS_INFOMANIAK_URL=${AI_MOCK_URL}`,
  'COGNOS_INFOMANIAK_PRODUCT_ID=e2e-dummy-product',
  // Requesty hosts the image models; point it at the mock so image generation
  // works offline (the mock serves both transports).
  'COGNOS_REQUESTY_API_KEY=e2e-dummy-key',
  `COGNOS_REQUESTY_URL=${AI_MOCK_URL}`,
  // Fixed 32-byte (base64) key so MFA TOTP enrolment works in e2e. Test-only,
  // not a real secret — it only ever seals throwaway seeds on the e2e stack.
  'COGNOS_MFA_TOTP_ENCRYPTION_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=', // gitleaks:allow
];
const BACKEND_SERVE_ARGS = [
  'go run ./cmd/api serve --dev',
  `--dir=${POCKETBASE_DIR}`,
  `--${POCKETBASE_LISTEN_FLAG}=${POCKETBASE_LISTEN_ADDR}`,
  ...(POCKETBASE.protocol === 'https:'
    ? [`--tlsCert=${TLS_CERT}`, `--tlsKey=${TLS_KEY}`]
    : []),
  ...(SKIP_FRONTEND ? [] : [`--publicDir=${FRONTEND_DIST_DIR}`, '--indexFallback']),
];
const TLS_CERT_COMMAND =
  POCKETBASE.protocol === 'https:'
    ? [
        `test -f ${TLS_CERT} -a -f ${TLS_KEY} || mkcert -cert-file=${TLS_CERT} -key-file=${TLS_KEY} localhost 127.0.0.1 cognos.local`,
      ]
    : [];
const BACKEND_COMMAND = [
  ...TLS_CERT_COMMAND,
  ...(SKIP_FRONTEND ? [] : ['pnpm --dir .. --filter @cognos/chat build:e2e']),
  // Idempotently provision the e2e superuser the API helpers use to mark
  // freshly-registered users as email-verified.
  [
    ...BACKEND_ENV,
    `go run ./cmd/api superuser upsert ${E2E_SUPERUSER_EMAIL} ${E2E_SUPERUSER_PASSWORD} --dir=${POCKETBASE_DIR}`,
  ].join(' '),
  [...BACKEND_ENV, BACKEND_SERVE_ARGS.join(' ')].join(' '),
].join(' && ');

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.E2E_WORKERS
    ? Number(process.env.E2E_WORKERS)
    : process.env.CI
      ? 2
      : 4,
  reporter: process.env.CI ? [['github'], ['html']] : 'html',
  use: {
    baseURL: BASE_URL,
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
          command:
            'sh -c ' +
            JSON.stringify(
              `E2E_AI_MOCK_PORT=${AI_MOCK_PORT} go run ./cmd/mock-ai-provider`,
            ),
          cwd: '../backend',
          url: AI_MOCK_HEALTH_URL,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 60_000,
        },
        {
          command: 'sh -c ' + JSON.stringify(BACKEND_COMMAND),
          cwd: '../backend',
          url: `${POCKETBASE_URL}/health`,
          ignoreHTTPSErrors: true,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 180_000,
        },
      ],
  metadata: {
    pocketbaseUrl: POCKETBASE_URL,
  },
});
