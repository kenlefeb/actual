// fork: sc-3567, sc-3554. Keeps the app clear of the iOS status bar, notch,
// rounded corners and home indicator. The env() insets are 0 in desktop
// browsers.
export function appSafeAreaPadding({
  isBudgetOpen,
  isNarrowWidth,
}: {
  isBudgetOpen: boolean;
  isNarrowWidth: boolean;
}) {
  // The phone budget screens pad the top in their own header (Page.tsx), so
  // its color runs under the status bar, and the bottom in their tab bar
  const isPhoneBudget = isBudgetOpen && isNarrowWidth;
  return {
    ...(!isPhoneBudget && { paddingTop: 'env(safe-area-inset-top)' }),
    // The file list screens pad their own bottom (WelcomeScreen, ServerURL)
    ...(isBudgetOpen &&
      !isNarrowWidth && { paddingBottom: 'env(safe-area-inset-bottom)' }),
    paddingLeft: 'env(safe-area-inset-left)',
    paddingRight: 'env(safe-area-inset-right)',
  };
}
