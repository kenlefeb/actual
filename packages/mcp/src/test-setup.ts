import * as path from 'path';

import { vi } from 'vitest';

declare global {
  var IS_TESTING: boolean;
  var currentMonth: string | null;
}

global.IS_TESTING = true;
global.currentMonth = '2026-01';

// Tests run from source; point loot-core's fs paths at its package root
// (same approach as packages/api/methods.test.ts).
vi.mock(
  '../../loot-core/src/platform/server/fs/index.api',
  async importOriginal => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    const lootCoreRoot = path.join(__dirname, '..', '..', 'loot-core');
    return {
      ...actual,
      migrationsPath: path.join(lootCoreRoot, 'migrations'),
      bundledDatabasePath: path.join(lootCoreRoot, 'default-db.sqlite'),
      demoBudgetPath: path.join(lootCoreRoot, 'demo-budget'),
    };
  },
);
