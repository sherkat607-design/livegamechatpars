// Builds the web client into mobile/www for the Android app, pointed at your server.
// Usage: LGCP_SERVER_URL=https://chat.example.com npm run android:sync
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverUrl = (process.env.LGCP_SERVER_URL ?? '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/]+$/.test(serverUrl)) {
  console.error('Set LGCP_SERVER_URL to the address of your server, for example:');
  console.error('  LGCP_SERVER_URL=https://chat.example.com npm run android:sync');
  process.exit(1);
}
if (serverUrl.startsWith('http://')) {
  console.warn('Warning: plain http is for local testing only. Use https for a real release.');
}

const clientDir = fileURLToPath(new URL('../../client', import.meta.url));
const result = spawnSync('npx', ['vite', 'build', '--outDir', '../mobile/www', '--emptyOutDir'], {
  cwd: clientDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, VITE_API_ORIGIN: serverUrl },
});
process.exit(result.status ?? 1);
