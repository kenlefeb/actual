// @ts-strict-ignore
import { md5 } from '@noble/hashes/legacy';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import { makeViews, schema, schemaConfig } from './aql';
import * as db from './db';
import * as migrations from './migrate/migrations';

// Managing the init/update process

async function runMigrations() {
  await migrations.migrate(db.getDatabase());
}

// MD5 as before, so stored hashes still match. Not node:crypto, which the
// browser build would polyfill with crypto-browserify (and elliptic)
export function hashViews(views: string) {
  return bytesToHex(md5(utf8ToBytes(views)));
}

async function updateViews() {
  const hashKey = 'view-hash';
  const row = await db.first<{ value: string }>(
    'SELECT value FROM __meta__ WHERE key = ?',
    [hashKey],
  );
  const { value: hash } = row || {};

  const views = makeViews(schema, schemaConfig);
  const currentHash = hashViews(views);

  if (hash !== currentHash) {
    db.execQuery(views);
    db.runQuery('INSERT OR REPLACE INTO __meta__ (key, value) VALUES (?, ?)', [
      hashKey,
      currentHash,
    ]);
  }
}

export async function updateVersion() {
  await runMigrations();
  await updateViews();
}
