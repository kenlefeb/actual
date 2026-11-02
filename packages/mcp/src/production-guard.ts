import type { McpConfig } from './config';

const FAIL = 'The production session token could not be validated.';

/**
 * Production start check: the token must belong to a user who is not ADMIN.
 * Fails closed with fixed text (never the token or the URL) on any doubt. The
 * sync server's GET /account/validate returns `data.permission`.
 */
export async function assertTokenNotAdmin(
  config: Pick<McpConfig, 'serverUrl' | 'sessionToken'>,
) {
  let permission: unknown;
  try {
    const res = await fetch(new URL('/account/validate', config.serverUrl), {
      headers: { 'x-actual-token': config.sessionToken ?? '' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error('rejected');
    permission = (
      (await res.json()) as { data?: { permission?: unknown } } | null
    )?.data?.permission;
  } catch {
    throw new Error(FAIL);
  }
  if (typeof permission !== 'string' || !permission) throw new Error(FAIL);
  if (permission.toUpperCase() === 'ADMIN') {
    throw new Error(
      'The production session token belongs to an administrator; refusing to start.',
    );
  }
}
