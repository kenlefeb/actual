// fork: sc-3567, sc-3554. Keeps the app clear of the iOS status bar, notch and
// rounded corners. The env() insets are 0 in desktop browsers.
export function appSafeAreaPadding({
  hasMobilePageHeader,
}: {
  // The phone budget screens pad the top in their own header (Page.tsx), so
  // its color runs under the status bar
  hasMobilePageHeader: boolean;
}) {
  return {
    ...(!hasMobilePageHeader && { paddingTop: 'env(safe-area-inset-top)' }),
    paddingLeft: 'env(safe-area-inset-left)',
    paddingRight: 'env(safe-area-inset-right)',
  };
}
