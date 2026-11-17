import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';
import { SCOPES } from '#grants';
import type { Grant } from '#grants';
import type { Limits } from '#limits';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  await h.close();
});

const grantOf = (over: Partial<Grant> = {}): Grant => ({
  scopes: [...SCOPES],
  confirm_destructive: false,
  ...over,
});

async function start(
  count: number,
  over: Partial<Grant> = {},
  limits?: Partial<Limits>,
) {
  h = await startHarness({ count }, { grant: grantOf(over), limits });
}

async function ids() {
  const { data } = (await api.runQuery(
    api
      .q('transactions')
      .filter({ account: h.fixture.accountId })
      .select(['id', 'notes'])
      .orderBy(['date', 'id']),
  )) as { data: Array<{ id: string; notes: string | null }> };
  return data;
}

const edit = (rows: Array<{ id: string }>) =>
  h.call('write_update_transactions', {
    updates: rows.map(t => ({ id: t.id, notes: 'changed' })),
  });

describe('Limits are configurable defaults', () => {
  it('Defaults: 51 rows are refused', async () => {
    await start(51);
    const res = await edit(await ids());
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/At most 50 rows/);
  });

  it('A setting changes the row limit', async () => {
    await start(51, {}, { maxRows: 60 });
    expect((await edit(await ids())).isError).toBe(false);
  });

  it('A grant overrides the setting', async () => {
    await start(51, { max_rows: 60 });
    expect((await edit(await ids())).isError).toBe(false);
    await h.close();
    await start(21, { max_rows: 20 }, { maxRows: 100 });
    expect((await edit(await ids())).isError).toBe(true);
  });

  it('The schema and descriptions derive from the settings', async () => {
    await start(1, {}, { rowsCeiling: 2000, maxRows: 75 });
    const { tools } = await h.client.listTools();
    const update = tools.find(t => t.name === 'write_update_transactions')!;
    expect(JSON.stringify(update.inputSchema)).toContain('"maxItems":2000');
    expect(update.description).toContain('up to 75 transactions');
    const create = tools.find(t => t.name === 'write_create_transactions')!;
    expect(create.description).toContain('up to 75 transactions');
    const del = tools.find(t => t.name === 'write_delete_category_group')!;
    expect(del.description).toContain('At most 50 categories');
  });

  it('A raised row limit does not widen a group delete', async () => {
    await start(1, { max_rows: 1000 });
    const group = await api.createCategoryGroup({ name: 'Big' });
    for (let i = 0; i < 51; i++) {
      await api.createCategory({ name: `C${i}`, group_id: group });
    }
    const res = await h.call('write_delete_category_group', {
      group_id: group,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/At most 50 rows may be deleted/);
    expect((await api.getCategoryGroups()).some(g => g.id === group)).toBe(
      true,
    );
  });

  it('A delete limit raises a group delete, up to the row limit', async () => {
    await start(1, { max_rows: 100, max_delete_rows: 100 });
    const group = await api.createCategoryGroup({ name: 'Big' });
    for (let i = 0; i < 51; i++) {
      await api.createCategory({ name: `C${i}`, group_id: group });
    }
    const res = await h.call('write_delete_category_group', {
      group_id: group,
    });
    expect(res.isError).toBe(false);
  });

  it('A lowered row limit still lowers a group delete', async () => {
    await start(1, { max_rows: 5 });
    const group = await api.createCategoryGroup({ name: 'Small' });
    for (let i = 0; i < 6; i++) {
      await api.createCategory({ name: `C${i}`, group_id: group });
    }
    const res = await h.call('write_delete_category_group', {
      group_id: group,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/At most 5 rows may be deleted/);
  });

  it('A raised row limit does not widen an account close', async () => {
    await start(1, { max_rows: 1000 });
    const big = await api.createAccount({ name: 'Big' }, 0);
    await api.addTransactions(
      big,
      Array.from({ length: 51 }, (_, i) => ({
        date: '2026-01-01',
        amount: -(i + 1),
      })),
    );
    const res = await h.call('write_delete_account', { account_id: big });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/At most 50 rows may be deleted/);
  });

  it('Undo of a large create uses the delete limit and says so', async () => {
    await start(1, { max_rows: 100 });
    const made = await h.call('write_create_transactions', {
      account_id: h.fixture.accountId,
      transactions: Array.from({ length: 51 }, (_, i) => ({
        date: '2026-03-01',
        amount: -(i + 1),
      })),
    });
    expect(made.isError).toBe(false);
    const res = await h.call('write_undo', { write_id: made.json.write_id });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/delete limit/);
    expect(res.text).toMatch(/undo of a create/);
    expect(await ids()).toHaveLength(52);
  });
});
