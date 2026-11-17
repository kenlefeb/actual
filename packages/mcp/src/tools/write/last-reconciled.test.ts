import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  await h.close();
});

async function lastReconciled(accountId: string) {
  const { data } = (await api.runQuery(
    api.q('accounts').filter({ id: accountId }).select(['last_reconciled']),
  )) as { data: Array<{ last_reconciled: string | null }> };
  return data[0].last_reconciled;
}

describe('last_reconciled (task 1.1)', () => {
  it('persists through api.updateAccount', async () => {
    h = await startHarness({ count: 1 }, { writes: true });
    const stamp = String(Date.now());
    expect(await lastReconciled(h.fixture.accountId)).toBeNull();
    await api.updateAccount(h.fixture.accountId, {
      last_reconciled: stamp,
    });
    expect(await lastReconciled(h.fixture.accountId)).toBe(stamp);
  });
});
