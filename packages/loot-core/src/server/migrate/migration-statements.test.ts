import * as nativeFs from 'fs';
import * as path from 'path';

import { getMigrationsDir, migrationSql } from './migrations';

// Each migration runs inside one transaction with its `__migrations__` row,
// so no migration may start, end or step outside a transaction itself. A SQL
// file's own leading `BEGIN TRANSACTION;` and trailing `COMMIT;` are the
// only exceptions, and `applyMigration` strips them. A `PRAGMA` that reads
// (`PRAGMA table_info(...)`) is fine; one that sets something is not.
const transactionControl =
  /\b(BEGIN|COMMIT|ROLLBACK|END\s+TRANSACTION|SAVEPOINT|RELEASE|VACUUM)\b/i;
const pragmaWrite = /\bPRAGMA\s+[\w.]+\s*=/i;

describe('Migration statements', () => {
  const dir = getMigrationsDir();
  const names = nativeFs
    .readdirSync(dir)
    .filter(name => name.endsWith('.sql') || name.endsWith('.js'));

  test('there are migrations to check', () => {
    expect(names.length).toBeGreaterThan(50);
  });

  test.each(names)('%s does not control the transaction', name => {
    const text = nativeFs.readFileSync(path.join(dir, name), 'utf8');
    const body = name.endsWith('.sql') ? migrationSql(text) : text;
    expect(body).not.toMatch(transactionControl);
    expect(body).not.toMatch(pragmaWrite);
  });

  test('a SQL file loses only its own outer BEGIN and COMMIT', () => {
    expect(
      migrationSql(
        'BEGIN TRANSACTION;\n\nCREATE TABLE a (id TEXT);\n\nCOMMIT;\n',
      ).trim(),
    ).toBe('CREATE TABLE a (id TEXT);');
    expect(migrationSql('CREATE TABLE a (id TEXT);')).toBe(
      'CREATE TABLE a (id TEXT);',
    );
    // As some real migrations are written: a comment first, no `;` after COMMIT
    expect(
      migrationSql(
        '-- Migration: a\nBEGIN TRANSACTION;\n\nCREATE TABLE a (id TEXT);\n\nCOMMIT',
      ).trim(),
    ).toBe('-- Migration: a\n\n\nCREATE TABLE a (id TEXT);');
  });
});
