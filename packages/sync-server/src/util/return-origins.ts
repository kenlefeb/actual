// fork: sc-4962. Origins an OpenID sign-in may return its token to.

// URL.origin is "null" for custom schemes, so compare scheme and host instead.
export function originOf(url: URL) {
  return `${url.protocol}//${url.host}`;
}

function plainOrigin(entry: string) {
  if (/[*?#]/.test(entry)) {
    return null;
  }
  try {
    const url = new URL(entry);
    const isPlain =
      url.host &&
      !url.username &&
      !url.password &&
      (url.pathname === '' || url.pathname === '/');
    return isPlain ? originOf(url) : null;
  } catch {
    return null;
  }
}

// Keeps the entries that are plain origins (scheme://host[:port]) and drops
// the rest, so a bad entry can never widen the list. Logs by index only.
export function validReturnOrigins(entries: string[]): string[] {
  return entries.flatMap((entry, index) => {
    const origin = plainOrigin(entry);
    if (origin === null) {
      console.warn(
        `Ignoring openId.allowedReturnOrigins entry ${index}: not a plain origin`,
      );
      return [];
    }
    return [origin];
  });
}
