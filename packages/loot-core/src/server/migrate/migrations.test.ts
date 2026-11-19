// @ts-strict-ignore
import * as nativeFs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as db from '#server/db';

import {
  getAppliedMigrations,
  getMigrationId,
  getMigrationList,
  getMigrationsDir,
  getPending,
  migrate,
  withMigrationsDir,
} from './migrations';

beforeEach(global.emptyDatabase(true));

describe('Migrations', () => {
  test('gets the latest migrations', async () => {
    const applied = await getAppliedMigrations(db.getDatabase());
    const available = await getMigrationList(
      __dirname + '/../../mocks/migrations',
    );

    expect(applied.length).toBe(0);
    expect(available).toMatchSnapshot();
    expect(getPending(applied, available)).toMatchSnapshot();
  });

  test('applied migrations are returned in order', async () => {
    const migrationsDir = __dirname + '/../../mocks/migrations';
    return withMigrationsDir(migrationsDir, async () => {
      await migrate(db.getDatabase());

      const migrations = await getAppliedMigrations(db.getDatabase());
      const expected = (await getMigrationList(migrationsDir)).map(
        getMigrationId,
      );
      expect(expected.length).toBeGreaterThan(0);
      expect(migrations).toEqual(expected);
    });
  });

  test('checks if there are unknown migrations', async () => {
    return withMigrationsDir(
      __dirname + '/../../mocks/migrations',
      async () => {
        // Insert a random migration id
        db.runQuery('INSERT INTO __migrations__ (id) VALUES (1000)');

        try {
          await migrate(db.getDatabase());
        } catch (e) {
          expect(e.message).toBe('out-of-sync-migrations');
          return;
        }
        expect('should never reach here').toBe(null);
      },
    );
  });

  test('tolerates migrations applied by a newer version of the app', async () => {
    return withMigrationsDir(
      __dirname + '/../../mocks/migrations',
      async () => {
        await migrate(db.getDatabase());

        // Simulate a migration applied by a newer version of the app
        // (its id is newer than anything this version knows about)
        db.runQuery('INSERT INTO __migrations__ (id) VALUES (9999999999999)');

        // Should not throw
        await migrate(db.getDatabase());

        const applied = await getAppliedMigrations(db.getDatabase());
        expect(applied).toContain(9999999999999);
      },
    );
  });

  test('rejects a newer unknown migration when a known one is missing', async () => {
    return withMigrationsDir(
      __dirname + '/../../mocks/migrations',
      async () => {
        // A database that skipped known migrations but somehow contains
        // one from a newer version — impossible via any legitimate flow
        // (append-only migrations mean the newer version knew ours too),
        // so it must be treated as corrupt, not migrated further
        db.runQuery('INSERT INTO __migrations__ (id) VALUES (1508717984291)');
        db.runQuery('INSERT INTO __migrations__ (id) VALUES (9999999999999)');

        await expect(migrate(db.getDatabase())).rejects.toThrow(
          'out-of-sync-migrations',
        );
      },
    );
  });

  test('applies a pending migration whose id sorts below an applied one', async () => {
    const dir = nativeFs.mkdtempSync(
      path.join(os.tmpdir(), 'interleaved-migrations-'),
    );
    try {
      nativeFs.writeFileSync(
        path.join(dir, '1790000000001_a.sql'),
        'CREATE TABLE interleave_a (id TEXT PRIMARY KEY);',
      );
      nativeFs.writeFileSync(
        path.join(dir, '1790000000003_c.sql'),
        'CREATE TABLE interleave_c (id TEXT PRIMARY KEY);',
      );
      await withMigrationsDir(dir, async () => {
        await migrate(db.getDatabase());
      });

      // A later release ships a migration authored earlier: its id
      // sorts between two already-applied ones. The upgrade must treat
      // it as pending, not as an out-of-sync database.
      nativeFs.writeFileSync(
        path.join(dir, '1790000000002_b.sql'),
        'CREATE TABLE interleave_b (id TEXT PRIMARY KEY);',
      );
      await withMigrationsDir(dir, async () => {
        await migrate(db.getDatabase());
      });

      const applied = await getAppliedMigrations(db.getDatabase());
      expect(applied).toContain(1790000000002);
      const desc = await db.first<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE name = 'interleave_b'",
      );
      expect(desc?.name).toBe('interleave_b');
    } finally {
      nativeFs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects a migrated database when no migrations exist on disk', async () => {
    await withMigrationsDir(__dirname + '/../../mocks/migrations', async () => {
      await migrate(db.getDatabase());
    });

    // An empty migrations directory — a broken install must not pass
    // validation just because every applied id looks unknown
    const dir = nativeFs.mkdtempSync(
      path.join(os.tmpdir(), 'empty-migrations-'),
    );
    try {
      await withMigrationsDir(dir, async () => {
        await expect(migrate(db.getDatabase())).rejects.toThrow(
          'out-of-sync-migrations',
        );
      });
    } finally {
      nativeFs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // A migration and its `__migrations__` row are one transaction: a failure
  // between them (on our storage path, a kill between two writes) must leave
  // neither, so the next open runs the migration again cleanly
  test('a migration whose row cannot be written leaves the schema unchanged', async () => {
    const dir = nativeFs.mkdtempSync(
      path.join(os.tmpdir(), 'atomic-migration-'),
    );
    try {
      nativeFs.writeFileSync(
        path.join(dir, '1790000000001_half.sql'),
        'BEGIN TRANSACTION;\nCREATE TABLE half_done (id TEXT PRIMARY KEY);\nCOMMIT;\n',
      );
      db.execQuery(
        "CREATE TRIGGER refuse_rows BEFORE INSERT ON __migrations__ BEGIN SELECT RAISE(ABORT, 'row refused'); END;",
      );
      await withMigrationsDir(dir, async () => {
        await expect(migrate(db.getDatabase())).rejects.toThrow('row refused');
      });
      const table = await db.first<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE name = 'half_done'",
      );
      expect(table).toBe(null);

      // The next open runs it again and records it
      db.execQuery('DROP TRIGGER refuse_rows');
      await withMigrationsDir(dir, async () => {
        await migrate(db.getDatabase());
      });
      expect(await getAppliedMigrations(db.getDatabase())).toContain(
        1790000000001,
      );
    } finally {
      nativeFs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a failing migration leaves nothing of itself behind', async () => {
    const dir = nativeFs.mkdtempSync(
      path.join(os.tmpdir(), 'atomic-migration-'),
    );
    try {
      nativeFs.writeFileSync(
        path.join(dir, '1790000000001_fails.sql'),
        'CREATE TABLE first_half (id TEXT PRIMARY KEY);\nSELECT * FROM no_such_table;\n',
      );
      await withMigrationsDir(dir, async () => {
        await expect(migrate(db.getDatabase())).rejects.toThrow(
          'no_such_table',
        );
      });
      const table = await db.first<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE name = 'first_half'",
      );
      expect(table).toBe(null);
      expect(await getAppliedMigrations(db.getDatabase())).toEqual([]);
    } finally {
      nativeFs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Every real migration, including the JavaScript ones whose own
  // `db.transaction` calls now nest inside the migration's transaction
  test('every real migration runs inside its own transaction', async () => {
    await migrate(db.getDatabase());
    const applied = await getAppliedMigrations(db.getDatabase());
    const available = await getMigrationList(getMigrationsDir());
    expect(applied).toEqual(available.map(getMigrationId));
  });

  // sc-5368 left budgets with 1686139660866_remove_account_type applied but
  // not recorded; re-running it fails ("no such column: type"), so the budget
  // would never open. The one narrow repair records it when its effect is there.
  test('a remove_account_type that ran but was not recorded is recorded, not re-run', async () => {
    const real = getMigrationsDir();
    const dir = nativeFs.mkdtempSync(path.join(os.tmpdir(), 'account-type-'));
    try {
      const names = (await getMigrationList(real)).slice(0, 20);
      expect(names[19]).toBe('1686139660866_remove_account_type.sql');
      for (const name of names) {
        nativeFs.copyFileSync(path.join(real, name), path.join(dir, name));
      }
      await withMigrationsDir(dir, async () => {
        await migrate(db.getDatabase());
      });
      // The kill: the column is gone, the row isn't there
      db.runQuery('DELETE FROM __migrations__ WHERE id = ?', [1686139660866]);

      await withMigrationsDir(dir, async () => {
        await migrate(db.getDatabase());
      });
      expect(await getAppliedMigrations(db.getDatabase())).toContain(
        1686139660866,
      );
    } finally {
      nativeFs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('app runs database migrations', async () => {
    return withMigrationsDir(
      __dirname + '/../../mocks/migrations',
      async () => {
        let desc = await db.first<{ sql: string }>(
          "SELECT * FROM sqlite_master WHERE name = 'poop'",
        );
        expect(desc).toBe(null);

        await migrate(db.getDatabase());

        desc = await db.first<{ sql: string }>(
          "SELECT * FROM sqlite_master WHERE name = 'poop'",
        );
        expect(desc).toBeDefined();
        expect(desc.sql.indexOf('is_income')).toBe(-1);
        expect(desc.sql.indexOf('is_expense')).not.toBe(-1);
      },
    );
  });
});
