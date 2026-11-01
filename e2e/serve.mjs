// Starts the built app on a fresh, throwaway database for end-to-end tests.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const port = process.argv[2] ?? '3123';
const dataDir = mkdtempSync(join(tmpdir(), 'lgcp-e2e-'));
const child = spawn(process.execPath, ['server/dist/index.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: port,
    DATA_DIR: dataDir,
    CLIENT_DIST: resolve('client/dist'),
    RATE_LIMIT: 'false',
    LOG_LEVEL: 'warn',
    ICE_SERVERS: '[]',
  },
});
const stop = () => {
  child.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => {
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(code ?? 0);
});
