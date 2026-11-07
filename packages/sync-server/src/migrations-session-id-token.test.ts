import { getAccountDb } from '#account-db';
import { down, up } from '../migrations/1794087464809-session-id-token';

// fork: sc-2970
const columns = (): string[] =>
  getAccountDb()
    .all('PRAGMA table_info(sessions)')
    .map((column: { name: string }) => column.name);

afterEach(async () => {
  await up();
  getAccountDb().mutate('DELETE FROM sessions WHERE token = ?', ['mig-test']);
});

it('adds a nullable id_token column that existing rows read as NULL', async () => {
  await down();
  expect(columns()).not.toContain('id_token');
  getAccountDb().mutate(
    'INSERT INTO sessions (token, expires_at, user_id, auth_method) VALUES (?, ?, ?, ?)',
    ['mig-test', -1, 'genericUser', 'openid'],
  );

  await up();

  expect(columns()).toContain('id_token');
  expect(
    getAccountDb().first('SELECT id_token FROM sessions WHERE token = ?', [
      'mig-test',
    ]),
  ).toEqual({ id_token: null });
});

it('up is safe to run again, so downgrade then upgrade still starts', async () => {
  await up();
  await expect(up()).resolves.toBeUndefined();
  expect(columns().filter(name => name === 'id_token')).toHaveLength(1);
});

it('down removes the column', async () => {
  await down();
  expect(columns()).not.toContain('id_token');
});
