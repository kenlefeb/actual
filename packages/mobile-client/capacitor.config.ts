import type { CapacitorConfig } from '@capacitor/cli';

const baseConfig: CapacitorConfig = {
  appId: 'org.actualbudget',
  appName: 'Actual Budget',
  // Staged from the web build by `bin/stage-www.mjs` (run by the sync
  // scripts), which leaves out files the native apps do not need.
  webDir: 'www',
};

const devConfig: CapacitorConfig = {
  ...baseConfig,
  android: {
    ...baseConfig.android,
    allowMixedContent: true,
  },
  server: {
    cleartext: true,
    // Put in http://10.0.2.2:5006 for Android emulator to access server running on local machine.
    allowNavigation: ['localhost', '10.0.2.2'],
  },
};

// Fork-only (sc-3398): keep Ken's production server and its Auth0 sign-in
// inside the app's WebView. Capacitor opens other hosts in Safari, which can't
// return to capacitor://localhost after sign-in. Hosts from actual-hosting
// production/households/ken.json.
const prodConfig: CapacitorConfig = {
  ...baseConfig,
  server: {
    allowNavigation: [
      'actual-production.owl-becrux.ts.net',
      'actual-staging.us.auth0.com',
    ],
  },
};

// NODE_ENV is unset in development, 'production' in production builds.
const config: CapacitorConfig =
  process.env.NODE_ENV === 'production' ? prodConfig : devConfig;

// https://capacitorjs.com/docs/config
// eslint-disable-next-line import/no-default-export
export default config;
