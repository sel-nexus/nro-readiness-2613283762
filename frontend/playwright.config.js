/** Start the exact production bundle for isolated Chromium journeys. */
import { defineConfig } from '@playwright/test';

const port = Number(process.env.PREVIEW_PORT || 4173);
const url = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 20000,
  workers: 2,
  use: { baseURL: url, channel: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: `npm run build && node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${port} --strictPort`,
    url,
    reuseExistingServer: !process.env.CI,
  },
});
