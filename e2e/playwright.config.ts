import { defineConfig } from '@playwright/test';

const PORT = 3123;

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    permissions: ['microphone', 'camera'],
    launchOptions: {
      // Fake camera and microphone so voice/video can be tested headless.
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node e2e/serve.mjs ${PORT}`,
    cwd: '..',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
