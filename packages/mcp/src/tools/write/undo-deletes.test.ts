import { existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';
import * as db from '@actual-app/core/server/db/index';

import { startHarness } from '#client-harness';
import { SCOPES } from '#grants';
import type { Grant } from '#grants';
import type { Limits } from '#limits';

import { budgetId } from './shared';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

type Tx = {
  id: string;
  account: string;
  amount: number;
  payee: string | null;
  category: string | null;
  transfer_id: string | null;
  parent_id: string | null;
};

async function rows(filter: Record<string, unknown> = {}) {
  const { data } = (await api.runQuery(
    api
      .q('transactions')
      .filter(filter)
      .options({ splits: 'all' })
      .select([
        'id',
        'account',
        'amount',
        'payee',
        'category',
        'transfer_id',
        'parent_id',
      ]),
  )) as { data: Tx[] };
  return data;
}

const alive = async (id: string) => (await rows({ id })).length === 1;

function lines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

let live: Grant; // the connection's grant; a test may lower a limit after the delete

async function setup(over: Partial<Grant> = {}, limits: Partial<Limits> = {}) {
  live = { scopes: [...SCOPES], confirm_destructive: false, ...over };
  h = await startHarness(
    { count: 1 },
    {
      grant: live,
      limits,
      identity: { user_id: 'u1', subject: 'sub1' },
    },
  );
  // The fixture has no sync server
  vi.spyOn(api, 'sync').mockResolvedValue(undefined);
  const checking = h.fixture.accountId;
  const savings = await api.createAccount({ name: 'Savings' }, 0);
  return { checking, savings };
}

async function transferPayee(account: string) {
  const payees = await api.getPayees();
  return payees.find(p => p.transfer_acct === account)!.id;
}

async function transfer(from: string, to: string) {
  await api.addTransactions(
    from,
    [{ date: '2026-11-10', amount: -5000, payee: await transferPayee(to) }],
    { runTransfers: true },
  );
  const out = (await rows({ account: from, amount: -5000 }))[0];
  const into = (await rows({ id: out.transfer_id! }))[0];
  return { out, into };
}

async function split(account: string, amount = 200000) {
  await api.addTransactions(account, [
    {
      date: '2026-11-01',
      amount,
      subtransactions: [{ amount: amount * 0.75 }, { amount: amount * 0.25 }],
    },
  ]);
  const parent = (await rows({ account, amount }))[0];
  const children = await rows({ parent_id: parent.id });
  return { parent, children };
}

const call = async (tool: string, args: Record<string, unknown>) => {
  const res = await h.call(tool, args);
  expect(res.isError, res.text).toBe(false);
  return res.json;
};
const undo = (write_id: string, extra: Record<string, unknown> = {}) =>
  h.call('write_undo', { write_id, ...extra });

async function deleteRows(ids: string[]) {
  return (await call('write_delete_transactions', { ids })).write_id as string;
}

describe('undo of a transaction delete', () => {
  it('restores a transfer pair with its ids, links and values', async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    const id = await deleteRows([out.id]);
    expect(await alive(out.id)).toBe(false);
    const res = await undo(id);
    expect(res.isError, res.text).toBe(false);
    expect(res.json.restored).toBe(2);
    const [o] = await rows({ id: out.id });
    const [i] = await rows({ id: into.id });
    expect(o).toMatchObject({ transfer_id: into.id, amount: -5000 });
    expect(i).toMatchObject({ transfer_id: out.id, amount: 5000 });
    const listed = (await h.call('list_writes')).json.writes;
    expect(
      listed.find((w: { write_id: string }) => w.write_id === id),
    ).toMatchObject({
      undone: true,
    });
  });

  it('restores a split with its children', async () => {
    const { checking } = await setup();
    const { parent, children } = await split(checking);
    const id = await deleteRows([parent.id]);
    const res = await undo(id);
    expect(res.isError, res.text).toBe(false);
    expect(await alive(parent.id)).toBe(true);
    for (const c of children) expect(await alive(c.id)).toBe(true);
  });

  it('relinks a partner split child with its earlier payee', async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    const sp = await split(savings);
    const child = sp.children[0];
    await db.deleteTransaction({ id: into.id });
    await db.updateTransaction({ id: out.id, transfer_id: child.id });
    const payee = await transferPayee(checking);
    await db.updateTransaction({ id: child.id, transfer_id: out.id, payee });
    const id = await deleteRows([out.id]);
    expect((await rows({ id: child.id }))[0].transfer_id).toBeNull();
    const res = await undo(id);
    expect(res.isError, res.text).toBe(false);
    expect(await alive(out.id)).toBe(true);
    expect((await rows({ id: child.id }))[0]).toMatchObject({
      transfer_id: out.id,
      payee,
    });
    expect((await rows({ id: out.id }))[0].transfer_id).toBe(child.id);
  });

  it('restores attachments', async () => {
    const { checking } = await setup();
    const [t] = await rows({ account: checking });
    await db.insertWithUUID('transaction_attachments', {
      transaction_id: t.id,
      name: 'r.pdf',
      mime: 'application/pdf',
      size: 1,
      sha256: 'a',
      encrypt_meta: '{}',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    const id = await deleteRows([t.id]);
    const left = async () =>
      (
        (await api.runQuery(api.q('transaction_attachments').select('id'))) as {
          data: unknown[];
        }
      ).data.length;
    expect(await left()).toBe(0);
    expect((await undo(id)).isError).toBe(false);
    expect(await left()).toBe(1);
  });

  it('is used once: a second undo names the first', async () => {
    const { checking } = await setup();
    const [t] = await rows({ account: checking });
    const id = await deleteRows([t.id]);
    expect((await undo(id)).isError).toBe(false);
    const again = await undo(id);
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/already undone/);
  });

  it('refuses when a logged row is no longer deleted, naming it', async () => {
    const { checking } = await setup();
    const [t] = await rows({ account: checking });
    const id = await deleteRows([t.id]);
    await api.undeleteRows({
      budget_id: await budgetId(),
      rows: [{ table: 'transactions', id: t.id }],
    });
    const res = await undo(id);
    expect(res.isError).toBe(true);
    expect(res.text).toContain(t.id);
  });

  it('refuses when the account was deleted, closed or the payee deleted, nothing changed', async () => {
    const { checking, savings } = await setup();
    const payee = await api.createPayee({ name: 'Landlord2' });
    await api.addTransactions(savings, [
      { date: '2026-11-02', amount: -10, payee },
    ]);
    const [t] = await rows({ account: savings });
    const id = await deleteRows([t.id]);
    await api.deletePayee(payee);
    const noPayee = await undo(id);
    expect(noPayee.isError).toBe(true);
    expect(noPayee.text).toContain(payee);
    await api.closeAccount(savings);
    const closed = await undo(id);
    expect(closed.isError).toBe(true);
    expect(closed.text).toContain(savings);
    expect(await alive(t.id)).toBe(false);
    void checking;
  });

  it('refuses when the account was reconciled after the delete, unless allow_reconciled is set on both', async () => {
    const { checking } = await setup({ allow_reconciled: true });
    const [t] = await rows({ account: checking });
    const id = await deleteRows([t.id]);
    await api.updateAccount(checking, {
      last_reconciled: String(Date.now() + 60_000),
    });
    const refused = await undo(id);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(checking);
    expect(await alive(t.id)).toBe(false);
    const ok = await undo(id, { allow_reconciled: true });
    expect(ok.isError, ok.text).toBe(false);
    expect(await alive(t.id)).toBe(true);
  });

  it('refuses when the partner split child is gone, naming it', async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    const sp = await split(savings);
    const child = sp.children[0];
    await db.deleteTransaction({ id: into.id });
    await db.updateTransaction({ id: out.id, transfer_id: child.id });
    await db.updateTransaction({
      id: child.id,
      transfer_id: out.id,
      payee: await transferPayee(checking),
    });
    const id = await deleteRows([out.id]);
    await api.deleteTransaction(sp.parent.id);
    const res = await undo(id);
    expect(res.isError).toBe(true);
    expect(res.text).toContain(child.id);
    expect(await alive(out.id)).toBe(false);
  });

  it('counts restored rows the way the delete did, against the delete limit', async () => {
    const { checking } = await setup();
    const { parent } = await split(checking);
    const id = await deleteRows([parent.id]); // 3 rows
    live.max_delete_rows = 2;
    const res = await undo(id);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/At most 2 rows/);
    expect(await alive(parent.id)).toBe(false);
    live.max_delete_rows = 3;
    expect((await undo(id)).isError).toBe(false);
  });

  it('attachments do not count: 3 rows with 3 attachments undo at a delete limit of 3', async () => {
    const { checking } = await setup({ max_delete_rows: 3 });
    await api.addTransactions(checking, [
      { date: '2026-11-02', amount: -1 },
      { date: '2026-11-03', amount: -2 },
    ]);
    const all = await rows({ account: checking });
    for (const t of all) {
      await db.insertWithUUID('transaction_attachments', {
        transaction_id: t.id,
        name: 'r.pdf',
        mime: 'application/pdf',
        size: 1,
        sha256: 'a',
        encrypt_meta: '{}',
        created_at: '2026-11-01T10:00:00.000Z',
      });
    }
    const id = await deleteRows(all.map(t => t.id));
    const res = await undo(id);
    expect(res.isError, res.text).toBe(false);
    for (const t of all) expect(await alive(t.id)).toBe(true);
  });

  it('a handler failure leaves everything deleted and the undo retryable', async () => {
    const { checking } = await setup();
    const [t] = await rows({ account: checking });
    const id = await deleteRows([t.id]);
    const real = api.undeleteRows;
    vi.spyOn(api, 'undeleteRows').mockImplementation(async arg => {
      if (arg.check) return real(arg);
      throw new Error('down');
    });
    const failed = await undo(id);
    expect(failed.isError).toBe(false);
    expect(failed.json.failed).toBeTruthy();
    expect(failed.json.restored).toBe(0);
    expect(await alive(t.id)).toBe(false);
    vi.mocked(api.undeleteRows).mockImplementation(real);
    expect((await undo(id)).isError).toBe(false);
    expect(await alive(t.id)).toBe(true);
  });

  it('names a restored row that a later change overrode', async () => {
    const { checking } = await setup();
    const [t] = await rows({ account: checking });
    const id = await deleteRows([t.id]);
    const real = api.undeleteRows;
    vi.spyOn(api, 'undeleteRows').mockImplementation(async arg => {
      const out = await real(arg);
      if (!arg.check) await api.deleteTransaction(t.id); // another device's later edit
      return out;
    });
    const res = await undo(id);
    expect(res.isError).toBe(false);
    expect(res.json.overridden).toEqual([t.id]);
    const outcome = lines().find(l => l.phase === 'outcome' && l.undoes === id);
    expect(outcome.overridden).toEqual([t.id]);
  });

  it('holds the write lock across sync, check and apply', async () => {
    const { checking } = await setup();
    const [t] = await rows({ account: checking });
    const id = await deleteRows([t.id]);
    vi.mocked(api.sync).mockImplementation(
      () => new Promise<void>(resolve => setTimeout(resolve, 300)),
    );
    const undoing = undo(id);
    await new Promise(r => setTimeout(r, 50));
    const other = await api.createCategoryGroup({ name: 'Later' });
    void other;
    const racing = h.call('write_create_category_group', { name: 'Racing' });
    await Promise.all([undoing, racing]);
    const all = lines();
    const undoOutcome = all.findIndex(
      l => l.phase === 'outcome' && l.undoes === id,
    );
    const raceAttempt = all.findIndex(
      l => l.tool === 'write_create_category_group' && l.phase === 'attempt',
    );
    expect(undoOutcome).toBeGreaterThan(-1);
    expect(raceAttempt).toBeGreaterThan(undoOutcome);
  });

  it('is listed as undoable', async () => {
    const { checking } = await setup();
    const [t] = await rows({ account: checking });
    const id = await deleteRows([t.id]);
    const listed = (await h.call('list_writes')).json.writes;
    expect(
      listed.find((w: { write_id: string }) => w.write_id === id),
    ).toMatchObject({
      undoable: true,
    });
  });
});

async function setupCategories(
  over: Partial<Grant> = {},
  limits: Partial<Limits> = {},
) {
  const s = await setup(over, limits);
  const groups = await api.getCategoryGroups();
  const bills = groups.find(g => g.name === 'Bills')!;
  const rent = (await api.getCategories()).find(c => c.name === 'Rent')!;
  const dining = await api.createCategory({
    name: 'Dining',
    group_id: bills.id,
  });
  const groceries = await api.createCategory({
    name: 'Groceries',
    group_id: bills.id,
  });
  await api.setBudgetAmount('2026-01', dining, 500);
  await api.setBudgetAmount('2026-02', dining, 300);
  await api.setBudgetAmount('2026-01', groceries, 100);
  await api.setBudgetAmount('2026-02', groceries, 50);
  return { ...s, bills: bills.id, rent: rent.id, dining, groceries };
}

async function cell(month: string, category: string) {
  const { categoryGroups } = await api.getBudgetMonth(month);
  return categoryGroups
    .flatMap(g => g.categories ?? [])
    .find(c => c.id === category)?.budgeted;
}

describe('undo of a transaction delete: more references', () => {
  it('refuses when the account was deleted', async () => {
    const { savings } = await setup();
    await api.addTransactions(savings, [{ date: '2026-11-02', amount: -10 }]);
    const [t] = await rows({ account: savings });
    const id = await deleteRows([t.id]);
    await api.deleteAccount(savings);
    const res = await undo(id);
    expect(res.isError).toBe(true);
    expect(res.text).toContain(`${savings} (account)`);
  });

  it('refuses when the restored category is gone, unless it forwards to a live one', async () => {
    const { checking } = await setupCategories();
    const cat = await api.createCategory({
      name: 'Hobby',
      group_id: (await api.getCategoryGroups())[0].id,
    });
    await api.addTransactions(checking, [
      { date: '2026-11-02', amount: -10, category: cat },
    ]);
    const t = (await rows({ category: cat }))[0];
    const id = await deleteRows([t.id]);
    await api.deleteCategory(cat);
    const refused = await undo(id);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(`${cat} (category)`);
    expect(await alive(t.id)).toBe(false);
  });

  it('allows a restored category that was deleted with a transfer', async () => {
    const { checking, groceries } = await setupCategories();
    const cat = await api.createCategory({
      name: 'Hobby',
      group_id: (await api.getCategoryGroups())[0].id,
    });
    await api.addTransactions(checking, [
      { date: '2026-11-02', amount: -10, category: cat },
    ]);
    const t = (await rows({ category: cat }))[0];
    const id = await deleteRows([t.id]);
    await api.deleteCategory(cat, groceries);
    const ok = await undo(id);
    expect(ok.isError, ok.text).toBe(false);
    expect(await alive(t.id)).toBe(true);
  });

  it('refuses a restored row that is itself reconciled, unless allow_reconciled is set on both', async () => {
    const { checking } = await setup({ allow_reconciled: true });
    const [t] = await rows({ account: checking });
    await api.updateTransaction(t.id, { cleared: true, reconciled: true });
    const id = await deleteRows([t.id]).catch(() => undefined);
    expect(id).toBeUndefined(); // the delete itself needs the override
    const w = await call('write_delete_transactions', {
      ids: [t.id],
      allow_reconciled: true,
    });
    const refused = await undo(w.write_id);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(t.id);
    expect(refused.text).toMatch(/Reconciled/);
    const ok = await undo(w.write_id, { allow_reconciled: true });
    expect(ok.isError, ok.text).toBe(false);
  });

  describe('a partner split child', () => {
    async function unlinked() {
      const { checking, savings } = await setup({ allow_reconciled: true });
      const { out, into } = await transfer(checking, savings);
      const sp = await split(savings);
      const child = sp.children[0];
      await db.deleteTransaction({ id: into.id });
      await db.updateTransaction({ id: out.id, transfer_id: child.id });
      await db.updateTransaction({
        id: child.id,
        transfer_id: out.id,
        payee: await transferPayee(checking),
      });
      const id = await deleteRows([out.id]);
      return { out, child, id };
    }

    it('refuses when it was reconciled since', async () => {
      const { out, child, id } = await unlinked();
      await db.updateTransaction({ id: child.id, reconciled: true });
      const res = await undo(id);
      expect(res.isError).toBe(true);
      expect(res.text).toContain(child.id);
      expect(await alive(out.id)).toBe(false);
    });

    it('refuses when it was linked elsewhere since', async () => {
      const { out, child, id } = await unlinked();
      await db.updateTransaction({ id: child.id, transfer_id: 'elsewhere' });
      const res = await undo(id);
      expect(res.isError).toBe(true);
      expect(res.text).toContain(`${child.id} (transfer_id)`);
      expect(await alive(out.id)).toBe(false);
    });
  });
});

describe('undo of a delete: grant, confirm and the line it writes', () => {
  it('needs the delete scopes, and no confirm under confirm_destructive', async () => {
    const { checking } = await setup({ confirm_destructive: true });
    const [t] = await rows({ account: checking });
    const dry = await call('write_delete_transactions', { ids: [t.id] });
    const del = await call('write_delete_transactions', {
      ids: [t.id],
      confirm: dry.confirm,
    });
    const ok = await undo(del.write_id);
    expect(ok.isError, ok.text).toBe(false);
    expect(ok.json.dry_run).toBeUndefined();
    expect(await alive(t.id)).toBe(true);
    await h.close();

    const { checking: c2 } = await setup({
      scopes: SCOPES.filter(s => s !== 'delete'),
    });
    const [t2] = await rows({ account: c2 });
    // Written by hand: this grant cannot delete
    const line = {
      time: '2026-11-01T00:00:00.000Z',
      user_id: 'u1',
      subject: 'sub1',
      scopes: [],
      tool: 'write_delete_transactions',
      call_id: 'planted',
      schema: 2,
      budget_id: await budgetId(),
      ids: [t2.id],
      changes: [
        {
          id: t2.id,
          field: 'transaction',
          before: { account: c2, payee: null, transfer_id: null },
          after: null,
        },
      ],
    };
    const { appendFileSync } = await import('fs');
    appendFileSync(
      h.auditLog,
      `${JSON.stringify({ ...line, phase: 'attempt' })}\n${JSON.stringify({ time: line.time, user_id: 'u1', subject: 'sub1', scopes: [], tool: line.tool, call_id: 'planted', phase: 'outcome', status: 'ok', applied: [t2.id], failed: null, created: [] })}\n`,
    );
    const refused = await undo('planted');
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/needs transactions:write delete/);
  });

  it('writes its line as the delete line with before and after swapped', async () => {
    const { checking, savings } = await setup();
    const { out } = await transfer(checking, savings);
    const id = await deleteRows([out.id]);
    const res = await undo(id);
    expect(res.isError, res.text).toBe(false);
    const all = lines().filter(l => l.phase === 'attempt');
    const del = all.find(l => l.call_id === id);
    const back = all.find(l => l.undoes === id);
    expect(back.budget_id).toBe(del.budget_id);
    expect(new Set(back.ids)).toEqual(new Set(del.ids));
    const swap = (c: {
      id: string;
      field: string;
      before: unknown;
      after: unknown;
    }) => ({
      id: c.id,
      field: c.field,
      before: c.after,
      after: c.before,
    });
    expect(back.changes).toEqual(del.changes.map(swap));
  });

  it('refuses a line whose logged values are not ids', async () => {
    const { checking } = await setup();
    const [t] = await rows({ account: checking });
    const { appendFileSync } = await import('fs');
    const base = {
      time: '2026-11-01T00:00:00.000Z',
      user_id: 'u1',
      subject: 'sub1',
      scopes: [],
      tool: 'write_delete_transactions',
      call_id: 'corrupt',
    };
    appendFileSync(
      h.auditLog,
      `${JSON.stringify({ ...base, phase: 'attempt', schema: 2, budget_id: await budgetId(), ids: [t.id], changes: [{ id: t.id, field: 'transaction', before: { account: 42, payee: null }, after: null }] })}\n${JSON.stringify({ ...base, phase: 'outcome', status: 'ok', applied: [t.id], failed: null, created: [] })}\n`,
    );
    const res = await undo('corrupt');
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not an id/);
  });
});

describe('undo of a category delete', () => {
  it('logs its rows, mapping change and transfer cells', async () => {
    const { dining, groceries, bills } = await setupCategories();
    await call('write_delete_category', {
      category_id: dining,
      transfer_category_id: groceries,
    });
    const attempt = lines().find(l => l.phase === 'attempt');
    expect(typeof attempt.budget_id).toBe('string');
    const f = (field: string) =>
      attempt.changes.filter((c: { field: string }) => c.field === field);
    expect(f('group_id')).toMatchObject([{ id: dining, before: bills }]);
    expect(f('mapping')).toMatchObject([
      { id: dining, before: dining, after: groceries },
    ]);
    expect(f('budgeted:2026-01')).toMatchObject([
      { id: groceries, before: 100, after: 600 },
    ]);
    expect(f('budgeted:2026-02')).toMatchObject([
      { id: groceries, before: 50, after: 350 },
    ]);
  });

  it('brings the category back with its id, mapping and the transfer cells', async () => {
    const { dining, groceries } = await setupCategories();
    await api.updateCategory(dining, { hidden: true });
    await api.addTransactions(h.fixture.accountId, [
      { date: '2026-01-10', amount: -40, category: dining },
    ]);
    const w = await call('write_delete_category', {
      category_id: dining,
      transfer_category_id: groceries,
    });
    expect(await cell('2026-01', groceries)).toBe(600);
    const res = await undo(w.write_id);
    expect(res.isError, res.text).toBe(false);
    const cat = (await api.getCategories()).find(c => c.id === dining)!;
    expect(cat).toMatchObject({ name: 'Dining', hidden: true });
    expect(await cell('2026-01', groceries)).toBe(100);
    expect(await cell('2026-02', groceries)).toBe(50);
    expect(await cell('2026-01', dining)).toBe(500);
    const tx = (await rows({ amount: -40 }))[0];
    expect(tx.category).toBe(dining);
  });

  it('refuses when the name is taken, naming the category and field', async () => {
    const { dining, groceries, bills } = await setupCategories();
    const w = await call('write_delete_category', {
      category_id: dining,
      transfer_category_id: groceries,
    });
    await api.createCategory({ name: 'Dining', group_id: bills });
    const res = await undo(w.write_id);
    expect(res.isError).toBe(true);
    expect(res.text).toContain(dining);
    expect(res.text).toContain('name');
    expect((await api.getCategories()).some(c => c.id === dining)).toBe(false);
  });

  it('refuses when a transfer cell changed, and the category stays deleted', async () => {
    const { dining, groceries } = await setupCategories();
    const w = await call('write_delete_category', {
      category_id: dining,
      transfer_category_id: groceries,
    });
    await api.setBudgetAmount('2026-01', groceries, 777);
    const res = await undo(w.write_id);
    expect(res.isError).toBe(true);
    expect(res.text).toContain(`${groceries}:2026-01`);
    expect((await api.getCategories()).some(c => c.id === dining)).toBe(false);
    expect(await cell('2026-02', groceries)).toBe(350);
  });

  it('refuses when its group was deleted later', async () => {
    const { dining, groceries } = await setupCategories();
    const g2 = await api.createCategoryGroup({ name: 'Temp' });
    const tmp = await api.createCategory({ name: 'Tmp', group_id: g2 });
    const w = await call('write_delete_category', { category_id: tmp });
    void dining;
    void groceries;
    await api.deleteCategoryGroup(g2);
    const res = await undo(w.write_id);
    expect(res.isError).toBe(true);
    expect(res.text).toContain(g2);
  });

  it('refuses when the transfer category is gone', async () => {
    const { dining, groceries } = await setupCategories();
    const w = await call('write_delete_category', {
      category_id: dining,
      transfer_category_id: groceries,
    });
    await api.deleteCategory(groceries);
    const res = await undo(w.write_id);
    expect(res.isError).toBe(true);
    expect(res.text).toContain(groceries);
  });

  it('a delete whose transfer cells exceed the cell limit is refused', async () => {
    const { dining, groceries } = await setupCategories({}, { maxCells: 1 });
    const res = await h.call('write_delete_category', {
      category_id: dining,
      transfer_category_id: groceries,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/budget cells/);
    expect(lines()).toHaveLength(0);
    expect((await api.getCategories()).some(c => c.id === dining)).toBe(true);
  });

  it('counts restored transfer cells against the cell limit', async () => {
    const { dining, groceries } = await setupCategories();
    const w = await call('write_delete_category', {
      category_id: dining,
      transfer_category_id: groceries,
    });
    live.max_cells = 1; // the delete moved 2 cells
    const refused = await undo(w.write_id);
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/At most 1 budget cells/);
    expect((await api.getCategories()).some(c => c.id === dining)).toBe(false);
    live.max_cells = 2;
    const ok = await undo(w.write_id);
    expect(ok.isError, ok.text).toBe(false);
  });

  it('refuses when a mapping row is not what the delete left', async () => {
    const { dining, groceries, rent } = await setupCategories();
    const w = await call('write_delete_category', {
      category_id: dining,
      transfer_category_id: groceries,
    });
    await db.update('category_mapping', { id: dining, transferId: rent });
    const res = await undo(w.write_id);
    expect(res.isError).toBe(true);
    expect(res.text).toContain(`${dining} (mapping)`);
    expect((await api.getCategories()).some(c => c.id === dining)).toBe(false);
  });

  it('refuses a line whose logged category values are not ids', async () => {
    const { dining } = await setupCategories();
    const { appendFileSync } = await import('fs');
    const base = {
      time: '2026-11-01T00:00:00.000Z',
      user_id: 'u1',
      subject: 'sub1',
      scopes: [],
      tool: 'write_delete_category',
      call_id: 'corrupt-cat',
    };
    appendFileSync(
      h.auditLog,
      `${JSON.stringify({
        ...base,
        phase: 'attempt',
        schema: 2,
        budget_id: await budgetId(),
        ids: [dining],
        changes: [
          { id: dining, field: 'name', before: 'Dining', after: null },
          { id: dining, field: 'group_id', before: 42, after: null },
        ],
      })}\n${JSON.stringify({ ...base, phase: 'outcome', status: 'ok', applied: [dining], failed: null, created: [] })}\n`,
    );
    const res = await undo('corrupt-cat');
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not an id/);
  });
});

describe('undo of a category group delete', () => {
  it('brings the group and its categories back with their ids', async () => {
    const { dining, groceries } = await setupCategories();
    const g = await api.createCategoryGroup({ name: 'Fun' });
    const a = await api.createCategory({ name: 'Games', group_id: g });
    const b = await api.createCategory({ name: 'Movies', group_id: g });
    await api.setBudgetAmount('2026-01', a, 20);
    await api.setBudgetAmount('2026-01', b, 30);
    const order = (await api.getCategoryGroups()).map(x => x.id);
    const inGroup = (await api.getCategoryGroups())
      .find(x => x.id === g)!
      .categories?.map(c => c.id);
    const w = await call('write_delete_category_group', {
      group_id: g,
      transfer_category_id: groceries,
    });
    expect(await cell('2026-01', groceries)).toBe(150);
    const res = await undo(w.write_id);
    expect(res.isError, res.text).toBe(false);
    const groups = await api.getCategoryGroups();
    const back = groups.find(x => x.id === g)!;
    expect(back.categories?.map(c => c.id)).toEqual(inGroup);
    expect(groups.map(x => x.id)).toEqual(order);
    expect(await cell('2026-01', groceries)).toBe(100);
    void dining;
  });

  it('refuses when a live group has the name', async () => {
    const { groceries } = await setupCategories();
    const g = await api.createCategoryGroup({ name: 'Fun' });
    const a = await api.createCategory({ name: 'Games', group_id: g });
    void a;
    const w = await call('write_delete_category_group', {
      group_id: g,
      transfer_category_id: groceries,
    });
    await api.createCategoryGroup({ name: 'Fun' });
    const res = await undo(w.write_id);
    expect(res.isError).toBe(true);
    expect(res.text).toContain(g);
    expect(res.text).toContain('name');
  });

  it('refuses a delete with a transfer when the group holds categories deleted earlier', async () => {
    const { groceries } = await setupCategories();
    const g = await api.createCategoryGroup({ name: 'Fun' });
    const a = await api.createCategory({ name: 'Games', group_id: g });
    await api.createCategory({ name: 'Movies', group_id: g });
    await api.deleteCategory(a);
    const res = await h.call('write_delete_category_group', {
      group_id: g,
      transfer_category_id: groceries,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/deleted earlier/);
    expect(lines()).toHaveLength(0);
  });
});

describe('a group delete that is allowed can be undone, at the default limits', () => {
  it('26 categories with a transfer: the delete and its undo both pass', async () => {
    const { groceries } = await setupCategories();
    const g = await api.createCategoryGroup({ name: 'Big' });
    const made: string[] = [];
    for (let i = 0; i < 26; i++) {
      made.push(await api.createCategory({ name: `Cat ${i}`, group_id: g }));
    }
    await api.setBudgetAmount('2026-01', made[0], 10);
    const inGroup = (await api.getCategoryGroups())
      .find(x => x.id === g)!
      .categories?.map(c => c.id);
    const w = await call('write_delete_category_group', {
      group_id: g,
      transfer_category_id: groceries,
    });
    const res = await undo(w.write_id);
    expect(res.isError, res.text).toBe(false);
    expect(res.json.restored).toBe(27);
    const back = (await api.getCategoryGroups()).find(x => x.id === g)!;
    expect(back.categories?.map(c => c.id)).toEqual(inGroup);
    expect(await cell('2026-01', groceries)).toBe(100);
  });

  it('a group holding earlier-deleted categories still deletes without a transfer', async () => {
    await setupCategories();
    const g = await api.createCategoryGroup({ name: 'Fun' });
    const a = await api.createCategory({ name: 'Games', group_id: g });
    await api.createCategory({ name: 'Movies', group_id: g });
    await api.deleteCategory(a);
    const res = await h.call('write_delete_category_group', { group_id: g });
    expect(res.isError, res.text).toBe(false);
    const back = await undo(res.json.write_id);
    expect(back.isError, back.text).toBe(false);
  });
});
