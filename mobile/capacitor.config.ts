import type { CapacitorConfig } from '@capacitor/cli';

// The app bundles the web client (built by scripts/prepare-web.mjs) and talks to the
// server set in LGCP_SERVER_URL. Plain http is only allowed for local testing.
const serverUrl = process.env.LGCP_SERVER_URL ?? '';
const insecure = serverUrl.startsWith('http://');

const config: CapacitorConfig = {
  appId: process.env.LGCP_APP_ID ?? 'com.livegamechatpars.app',
  appName: 'لایو گیم چت پارس',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    ...(insecure ? { cleartext: true } : {}),
  },
  android: {
    backgroundColor: '#0B1626',
    allowMixedContent: insecure,
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'native',
      initialViewportFitValueHint: 'cover',
      style: 'DARK',
    },
  },
};

export default config;
