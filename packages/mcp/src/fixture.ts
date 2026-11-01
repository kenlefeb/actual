import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import * as api from '@actual-app/api';

export type FixtureTransaction = {
  payee_name?: string;
  imported_payee?: string;
  notes?: string;
};

/**
 * Builds a throwaway budget in a temp data directory through the real API
 * (no sync server): one on-budget account "Checking" with `count`
 * transactions, one category and one payee. Call `cleanup` when done.
 */
export async function buildFixtureBudget({
  count = 3,
  overrides = {},
}: { count?: number; overrides?: FixtureTransaction } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'actual-mcp-fixture-'));
  await api.init({ dataDir });
  let accountId = '';
  await api.runImport('fixture', async () => {
    accountId = await api.createAccount({ name: 'Checking', offbudget: false });
    const groupId = await api.createCategoryGroup({ name: 'Bills' });
    await api.createCategory({ name: 'Rent', group_id: groupId });
    await api.createPayee({ name: 'Landlord' });
    const day = (i: number) =>
      new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    await api.addTransactions(
      accountId,
      Array.from({ length: count }, (_, i) => ({
        date: day(i),
        amount: -(i + 1) * 100,
        ...overrides,
      })),
    );
  });
  return {
    dataDir,
    accountId,
    cleanup: async () => {
      await api.shutdown();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
