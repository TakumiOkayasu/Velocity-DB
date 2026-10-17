const { defineConfig } = require('@playwright/test');

// CI ではビルド済みの成果物を使い、WebView2 と同じバンドルを検証する。
const usePreview = process.env.VELOCITYDB_E2E_PREVIEW === '1';

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  webServer: {
    // bun は Playwright worker_threads と非互換のためローカル Vite+ CLI を直接起動する
    command: usePreview
      ? './node_modules/.bin/vp preview --port 5173'
      : './node_modules/.bin/vp dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !usePreview,
    timeout: 30_000,
  },
});
