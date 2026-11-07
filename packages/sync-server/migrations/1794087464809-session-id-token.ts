import { getAccountDb } from '../src/account-db';

// fork: sc-2970. The OpenID ID token, kept with its session for the logout hint.
function hasIdToken(): boolean {
  return getAccountDb()
    .all('PRAGMA table_info(sessions)')
    .some((column: { name: string }) => column.name === 'id_token');
}

export const up = async function (): Promise<void> {
  // Checked first, so downgrade then upgrade still starts the server
  if (!hasIdToken()) {
    getAccountDb().exec('ALTER TABLE sessions ADD COLUMN id_token TEXT');
  }
};

export const down = async function (): Promise<void> {
  if (hasIdToken()) {
    getAccountDb().exec('ALTER TABLE sessions DROP COLUMN id_token');
  }
};
