import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Standalone config for the one-off DOM discovery script.
 * Kept separate so `npm test` never collects recon as part of the real suite.
 */
export default defineConfig({
  testDir: '.',
  outputDir: '../artifacts/recon-results',
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'https://ask.permission.ai',
    navigationTimeout: 60_000,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
  },
});
