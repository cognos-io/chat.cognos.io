import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.WEB_E2E_BASE_URL ?? 'http://127.0.0.1:4321';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'line',
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: process.env.WEB_E2E_SKIP_SERVER
    ? undefined
    : {
        command: 'pnpm build && pnpm exec astro preview --host 127.0.0.1 --port 4321',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
