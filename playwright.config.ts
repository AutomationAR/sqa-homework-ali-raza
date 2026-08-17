import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Playwright configuration for the ask.permission.ai suite.
 *
 * Timeout budget is deliberately generous: every meaningful test in this suite
 * waits on a live LLM returning a response over the network. A 30s hard ceiling
 * for a single response (AGENT_REPLY_TIMEOUT in tests/pages/ask-page.ts) plus
 * page load and typing lands comfortably under the 90s per-test budget below.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './artifacts/test-results',

  /* Fail the build if a test was accidentally left with test.only. */
  forbidOnly: !!process.env.CI,

  /* One retry: the system under test is a live third-party LLM endpoint, so a
   * transient upstream 5xx or a cold-start timeout is not a product defect.
   * Retries are capped at 1 so a genuinely broken build still fails fast, and
   * every retry is visible in the HTML report rather than silently swallowed. */
  retries: process.env.CI ? 2 : 1,

  /* Serial on CI for reproducible traces; parallel locally for speed. */
  workers: process.env.CI ? 1 : 3,

  /* Per-test ceiling. Streaming responses dominate this. */
  timeout: 90_000,

  expect: {
    /* Default assertion timeout. Assertions that wait on the LLM pass an
     * explicit longer timeout at the call site rather than inflating this. */
    timeout: 10_000,
  },

  reporter: [
    ['html', { outputFolder: 'artifacts/report', open: 'never' }],
    ['list'],
    ['json', { outputFile: 'artifacts/report/results.json' }],
  ],

  use: {
    baseURL: process.env.BASE_URL ?? 'https://ask.permission.ai',

    /* Every test in this suite asserts the ANONYMOUS experience, so the empty
     * context is pinned here as a stated contract rather than left to the
     * default. Playwright already isolates each test in a fresh context, so this
     * is belt-and-braces: it stops a future signed-in project or global setup
     * from silently leaking a session into these specs. The matching runtime
     * assertions live in tests/helpers/state-check.ts.
     *
     * serviceWorkers is deliberately left at 'allow': the app registers none
     * (artifacts/recon/04-network.json), so blocking them would be config noise
     * implying a cache problem that does not exist. */
    storageState: { cookies: [], origins: [] },

    /* Diagnostics: full trace on the retry so a flake can be root-caused
     * without re-running, but no trace cost on the happy path. */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    navigationTimeout: 45_000,
    actionTimeout: 15_000,

    /* Paces actions so a live audience can follow along. Auto-enabled whenever
     * the run is headed (i.e. someone is watching), zero otherwise so CI pays
     * nothing. Override with SLOWMO=0 or SLOWMO=600. Detected from argv rather
     * than an env var so it works identically in bash, cmd and PowerShell with
     * no cross-env dependency. */
    launchOptions: {
      slowMo: process.env.SLOWMO
        ? Number(process.env.SLOWMO)
        : process.argv.includes('--headed')
          ? 250
          : 0,
    },
  },

  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
      /* The mobile-layout test is meaningless at desktop width. */
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      /* Only the responsive-layout spec runs on mobile. Re-running the seven
       * functional tests on a second viewport would double suite runtime and
       * double load on a live LLM backend for near-zero extra signal. */
      testMatch: /mobile\.spec\.ts/,
    },
  ],
});
