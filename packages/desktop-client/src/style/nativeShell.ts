// fork: sc-3505. The native Home Economics apps are the iOS Capacitor app, the
// macOS Electron app ('mac') and, from sc-4942, the SwiftUI Mac app
// ('mac-app'), which names itself in its web view's user agent. Windows and
// Linux Electron builds, the Android app and every browser keep upstream's look.
type ShellWindow = {
  Capacitor?: { getPlatform?: () => string };
  navigator: { userAgent: string };
};

export function nativeShell(
  win: ShellWindow = window,
): 'ios' | 'mac' | 'mac-app' | null {
  if (win.Capacitor?.getPlatform?.() === 'ios') return 'ios';
  const ua = win.navigator.userAgent;
  if (ua.includes('HomeEconomicsMac/')) return 'mac-app';
  return ua.includes('Electron') && ua.includes('Macintosh') ? 'mac' : null;
}

export function isNativeShell(win?: ShellWindow) {
  return nativeShell(win) !== null;
}
