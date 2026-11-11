// fork: sc-3398. The provider's sign-out returns to the server's own address,
// which in the iOS app loads the server-hosted copy of Actual inside the app.
// The app's sign-in screen is its bundled copy, at the address Capacitor
// injects into every page as WEBVIEW_SERVER_URL; a browser has none.
export function nativeAppHomeUrl(win: {
  WEBVIEW_SERVER_URL?: unknown;
  location: { href: string };
}): string | null {
  const home = win.WEBVIEW_SERVER_URL;
  if (typeof home !== 'string' || !home) return null;
  return win.location.href.startsWith(home) ? null : `${home}/`;
}
