// fork: sc-3505. The native Home Economics apps are the iOS Capacitor app and
// the macOS Electron app. Windows and Linux Electron builds, the Android app
// and every browser keep upstream's look.
type ShellWindow = {
  Capacitor?: { getPlatform?: () => string };
  navigator: { userAgent: string };
};

export function nativeShell(win: ShellWindow = window): 'ios' | 'mac' | null {
  if (win.Capacitor?.getPlatform?.() === 'ios') return 'ios';
  const ua = win.navigator.userAgent;
  return ua.includes('Electron') && ua.includes('Macintosh') ? 'mac' : null;
}

export function isNativeShell(win?: ShellWindow) {
  return nativeShell(win) !== null;
}
