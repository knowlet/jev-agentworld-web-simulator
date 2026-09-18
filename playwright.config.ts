import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 30000, workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'reports/browser', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'bun run start', url: 'http://127.0.0.1:4173/api/health', timeout: 30000,
    env: { APP_MODE: 'mock', PORT: '4173', WORLD_DB: ':memory:', HOST: '127.0.0.1' } },
});
