// fork: sc-3103. The page the identity provider sends back to after sign-out
// must not join the SharedWorker coordinator. The tab that left for the
// provider may never report closing, so the coordinator can hand the new page
// to a backend that is gone, and it hangs on "Loading global preferences...".
// The same fix upstream applies to the sign-in return (/openid-cb).
const KEY = 'actual-provider-sign-out';

export function markProviderSignOut() {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    // No session storage: the next page joins the coordinator as before.
  }
}

/** True once, on the first page load after markProviderSignOut. */
export function consumeProviderSignOut() {
  try {
    const isReturn = sessionStorage.getItem(KEY) === '1';
    sessionStorage.removeItem(KEY);
    return isReturn;
  } catch {
    return false;
  }
}
