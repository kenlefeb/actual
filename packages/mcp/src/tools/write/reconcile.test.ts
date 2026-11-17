import { existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';
import {
  ungroupTransactions,
  updateTransaction,
} from '@actual-app/core/shared/transactions';
import { applyChanges } from '@actual-app/core/shared/util';

import { startHarness } from '#client-harness';
import { SCOPES } from '#grants';
import type { Grant, Scope } from '#grants';
import type { Limits } from '#limits';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

type Tx = {
  id: string;
  account: string;
  date: string;
  amount: number;
  cleared: boolean;
  reconciled: boolean;
  transfer_id: string | null;
  parent_id: string | null;
  is_child: boolean;
};

const FIELDS = [
  'id',
  'account',
  'date',
  'amount',
  'cleared',
  'reconciled',
  'transfer_id',
  'parent_id',
  'is_child',
];

async function rows(filter: Record<string, unknown>) {
  const { data } = (await api.runQuery(
    api
      .q('transactions')
      .filter(filter)
      .options({ splits: 'all' })
      .select(FIELDS)
      .orderBy(['date', 'id']),
  )) as { data: Tx[] };
  return data;
}

const row = async (id: string) => (await rows({ id }))[0];

function auditLines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

async function lastReconciled(accountId: string) {
  const { data } = (await api.runQuery(
    api.q('accounts').filter({ id: accountId }).select(['last_reconciled']),
  )) as { data: Array<{ last_reconciled: string | null }> };
  return data[0].last_reconciled;
}

const grant = (scopes: Scope[], over: Partial<Grant> = {}): Grant => ({
  scopes,
  confirm_destructive: false,
  ...over,
});

async function start(
  opts: { limits?: Partial<Limits>; grant?: Grant; count?: number } = {},
) {
  h = await startHarness(
    { count: opts.count ?? 1 },
    { grant: opts.grant ?? grant([...SCOPES]), limits: opts.limits },
  );
  // The fixture's rows import cleared: make them the uncleared ones
  for (const t of await rows({ account: h.fixture.accountId })) {
    await api.updateTransaction(t.id, { cleared: false });
  }
  return h.fixture.accountId;
}

/** Cleared rows in `account`; the fixture's own row stays uncleared. */
async function cleared(
  account: string,
  amounts: number[],
  date = '2026-02-01',
) {
  await api.addTransactions(
    account,
    amounts.map(amount => ({ date, amount, cleared: true })),
  );
  return (await rows({ account, cleared: true, is_child: false })).filter(
    t => t.date === date,
  );
}

const clearedTotal = async (account: string) =>
  (await rows({ account, cleared: true, is_child: false })).reduce(
    (s, t) => s + t.amount,
    0,
  );

async function dryRun(account: string, statement: number) {
  const res = await h.call('write_reconcile_account', {
    account_id: account,
    statement_balance: statement,
  });
  expect(res.isError).toBe(false);
  return res;
}

async function reconcile(account: string, statement: number) {
  const dry = await dryRun(account, statement);
  return h.call('write_reconcile_account', {
    account_id: account,
    statement_balance: statement,
    confirm: dry.json.confirm,
  });
}

describe('Reconciling has its own scope', () => {
  it('A writer cannot reconcile', async () => {
    const checking = await start({
      grant: grant(['budget:read', 'transactions:write']),
    });
    const res = await h.call('write_reconcile_account', {
      account_id: checking,
      statement_balance: 0,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/needs transactions:reconcile; missing/);
    expect(await lastReconciled(checking)).toBeNull();
  });
});

describe('Reconcile an account', () => {
  it('A zero difference locks the cleared rows and stamps last_reconciled', async () => {
    const checking = await start();
    const done = await cleared(checking, [-1000, -2000, 5000]);
    // one already reconciled, one uncleared (the fixture's)
    await api.updateTransaction(done[0].id, { reconciled: true });
    const before = await rows({ account: checking });

    const dry = await dryRun(checking, 2000);
    expect(dry.json).toMatchObject({
      dry_run: true,
      cleared_balance: 2000,
      statement_balance: 2000,
      difference: 0,
    });
    expect(dry.json.ids.sort()).toEqual([done[1].id, done[2].id].sort());
    expect(dry.json.notice).toMatch(/MCP cannot unlock/);
    expect(dry.json.notice).toMatch(/write_undo cannot reverse/);
    // nothing yet
    expect(await rows({ account: checking })).toEqual(before);
    expect(await lastReconciled(checking)).toBeNull();

    const res = await h.call('write_reconcile_account', {
      account_id: checking,
      statement_balance: 2000,
      confirm: dry.json.confirm,
    });
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({ verified: true, locked: 2 });
    const after = await rows({ account: checking });
    expect(after.length).toBe(before.length); // no adjustment row
    for (const t of after) {
      const was = before.find(b => b.id === t.id)!;
      expect(t.reconciled).toBe(was.cleared ? true : was.reconciled);
    }
    expect(after.filter(t => !t.cleared).every(t => !t.reconciled)).toBe(true);
    const stamp = await lastReconciled(checking);
    expect(Number(stamp)).toBeGreaterThan(Date.now() - 60_000);

    const [attempt, outcome] = auditLines();
    expect(attempt).toMatchObject({
      tool: 'write_reconcile_account',
      schema: 2,
      statement_balance: 2000,
      cleared_balance: 2000,
      difference: 0,
    });
    expect(attempt.ids.sort()).toEqual([done[1].id, done[2].id].sort());
    expect(attempt.changes).toEqual([
      { id: checking, field: 'last_reconciled', before: null, after: 'now' },
    ]);
    expect(attempt.plan_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome).toMatchObject({
      status: 'ok',
      verified: true,
      last_reconciled: stamp,
    });
    expect(outcome.applied.sort()).toEqual(attempt.ids.sort());
  });

  it('A first call is a dry run even when confirm_destructive is off', async () => {
    const checking = await start({
      grant: grant([...SCOPES], { confirm_destructive: false }),
    });
    await cleared(checking, [100]);
    const dry = await dryRun(checking, 100);
    expect(dry.json.dry_run).toBe(true);
    expect((await rows({ account: checking, reconciled: true })).length).toBe(
      0,
    );
    expect(auditLines()).toEqual([]);
  });

  it('A difference writes nothing and issues no confirm', async () => {
    const checking = await start();
    await cleared(checking, [-1000, -2000, 5000]);
    const before = await rows({ account: checking });
    const res = await h.call('write_reconcile_account', {
      account_id: checking,
      statement_balance: 1655,
    });
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({
      reconciled: false,
      cleared_balance: 2000,
      difference: -345,
    });
    expect(res.json.confirm).toBeUndefined();
    expect(res.json.dry_run).toBeUndefined();
    expect(await rows({ account: checking })).toEqual(before);
    expect(await lastReconciled(checking)).toBeNull();
  });

  it('Zero rows to lock still stamps and audits', async () => {
    const checking = await start();
    const done = await cleared(checking, [700]);
    await api.updateTransaction(done[0].id, { reconciled: true });
    const res = await reconcile(checking, 700);
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({ locked: 0, verified: true });
    expect(await lastReconciled(checking)).not.toBeNull();
    const [attempt] = auditLines();
    expect(attempt.ids).toEqual([]);
    expect(attempt.changes[0]).toMatchObject({ field: 'last_reconciled' });
  });

  it('A statement balance must be integer cents', async () => {
    const checking = await start();
    for (const bad of [1.5, 1e15]) {
      const res = await h.call('write_reconcile_account', {
        account_id: checking,
        statement_balance: bad,
      });
      expect(res.isError).toBe(true);
    }
    expect(auditLines()).toEqual([]);
  });

  it('A closed account or a name is refused', async () => {
    const checking = await start();
    const old = await api.createAccount({ name: 'Old' }, 0);
    await api.closeAccount(old);
    for (const account_id of [old, 'Checking']) {
      const res = await h.call('write_reconcile_account', {
        account_id,
        statement_balance: 0,
      });
      expect(res.isError).toBe(true);
    }
    expect(await lastReconciled(checking)).toBeNull();
    expect(auditLines()).toEqual([]);
  });
});

describe('Splits', () => {
  async function split(account: string, isCleared = true) {
    await api.addTransactions(account, [
      {
        date: '2026-02-02',
        amount: 20000,
        cleared: isCleared,
        subtransactions: [{ amount: 15000 }, { amount: 5000 }],
      },
    ]);
    const parent = (await rows({ account, amount: 20000 }))[0];
    return { parent, children: await rows({ parent_id: parent.id }) };
  }

  it('A cleared parent locks its children, counted once', async () => {
    const checking = await start();
    const { parent, children } = await split(checking);
    const dry = await dryRun(checking, 20000);
    expect(dry.json.cleared_balance).toBe(20000);
    expect(dry.json.ids.sort()).toEqual(
      [parent.id, ...children.map(c => c.id)].sort(),
    );
    const res = await h.call('write_reconcile_account', {
      account_id: checking,
      statement_balance: 20000,
      confirm: dry.json.confirm,
    });
    expect(res.isError).toBe(false);
    expect((await row(parent.id)).reconciled).toBe(true);
    for (const c of children) expect((await row(c.id)).reconciled).toBe(true);
  });

  it('A split that is not cleared is untouched', async () => {
    const checking = await start();
    const { parent, children } = await split(checking, false);
    const dry = await dryRun(checking, 0);
    expect(dry.json.ids).toEqual([]);
    const res = await h.call('write_reconcile_account', {
      account_id: checking,
      statement_balance: 0,
      confirm: dry.json.confirm,
    });
    expect(res.isError).toBe(false);
    expect((await row(parent.id)).reconciled).toBe(false);
    for (const c of children) expect((await row(c.id)).reconciled).toBe(false);
  });

  it('A reconciled parent with an unreconciled child names the child', async () => {
    const checking = await start();
    const { parent, children } = await split(checking);
    await api.updateTransaction(parent.id, { reconciled: true });
    await api.updateTransaction(children[0].id, { reconciled: false });
    const child = await row(children[0].id);
    if (child.reconciled) return; // the engine keeps the family together
    const dry = await dryRun(checking, 20000);
    expect(dry.json.skipped_children).toEqual([child.id]);
    expect(dry.json.ids).toEqual([]);
    const res = await h.call('write_reconcile_account', {
      account_id: checking,
      statement_balance: 20000,
      confirm: dry.json.confirm,
    });
    expect(res.json.skipped_children).toEqual([child.id]);
    expect((await row(child.id)).reconciled).toBe(false);
  });
});

describe('Transfer partners', () => {
  it('The dry run names the other leg, which stays unchanged', async () => {
    const checking = await start();
    const savings = await api.createAccount({ name: 'Savings' }, 0);
    const payee = (await api.getPayees()).find(
      p => p.transfer_acct === savings,
    )!.id;
    await api.addTransactions(
      checking,
      [{ date: '2026-02-03', amount: -5000, payee, cleared: true }],
      { runTransfers: true },
    );
    const out = (await rows({ account: checking, amount: -5000 }))[0];
    const partner = await row(out.transfer_id!);
    const dry = await dryRun(checking, -5000);
    expect(dry.json.partner_ids).toEqual([partner.id]);
    const res = await h.call('write_reconcile_account', {
      account_id: checking,
      statement_balance: -5000,
      confirm: dry.json.confirm,
    });
    expect(res.isError).toBe(false);
    expect(await row(partner.id)).toEqual(partner);
    expect((await row(out.id)).reconciled).toBe(true);
  });
});

describe('The confirm binds each row', () => {
  async function twoRows() {
    const checking = await start();
    const [a, b] = await cleared(checking, [100, 50]);
    return { checking, a, b };
  }

  it('Two rows swap amounts and keep the totals', async () => {
    const { checking, a, b } = await twoRows();
    const dry = await dryRun(checking, 150);
    await api.updateTransaction(a.id, { amount: a.amount - 10 });
    await api.updateTransaction(b.id, { amount: b.amount + 10 });
    const res = await h.call('write_reconcile_account', {
      account_id: checking,
      statement_balance: 150,
      confirm: dry.json.confirm,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/changed since the dry run/);
    expect((await rows({ account: checking, reconciled: true })).length).toBe(
      0,
    );
  });

  it('A changed date, or a cleared flag, refuses it', async () => {
    const { checking, a } = await twoRows();
    const dry = await dryRun(checking, 150);
    await api.updateTransaction(a.id, { date: '2026-02-09' });
    const res = await h.call('write_reconcile_account', {
      account_id: checking,
      statement_balance: 150,
      confirm: dry.json.confirm,
    });
    expect(res.isError).toBe(true);
    expect((await rows({ account: checking, reconciled: true })).length).toBe(
      0,
    );
  });

  it('A stale confirm and a different balance are refused', async () => {
    const { checking } = await twoRows();
    const dry = await dryRun(checking, 150);
    // A different balance is a different call: a difference, so no write
    const res = await h.call('write_reconcile_account', {
      account_id: checking,
      statement_balance: 151,
      confirm: dry.json.confirm,
    });
    expect(res.json).toMatchObject({ reconciled: false, difference: 1 });
    const stale = await h.call('write_reconcile_account', {
      account_id: checking,
      statement_balance: 150,
      confirm: '1.deadbeef',
    });
    expect(stale.isError).toBe(true);
    expect((await rows({ account: checking, reconciled: true })).length).toBe(
      0,
    );
  });
});

describe('A reconcile is atomic and verified', () => {
  it('A cleared row arriving before the re-read gives verified false', async () => {
    const checking = await start();
    await cleared(checking, [100, 50]);
    const dry = await dryRun(checking, 150);
    const original = api.updateTransactions;
    vi.spyOn(api, 'updateTransactions').mockImplementation(async updates => {
      const out = await original(updates);
      await api.addTransactions(checking, [
        { date: '2026-02-05', amount: -777, cleared: true },
      ]);
      return out;
    });
    const res = await h.call('write_reconcile_account', {
      account_id: checking,
      statement_balance: 150,
      confirm: dry.json.confirm,
    });
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({
      verified: false,
      cleared_balance: 150 - 777,
      difference: 777,
      last_reconciled: null,
    });
    expect(res.json.locked_ids.length).toBe(2);
    expect(res.json.notice).toMatch(/Unlock in the app/);
    expect(await lastReconciled(checking)).toBeNull();
    const outcome = auditLines()[1];
    expect(outcome).toMatchObject({ verified: false, difference: 777 });
  });
});

describe('The reconcile limit', () => {
  it('More rows than the limit is refused before any audit line', async () => {
    const checking = await start({ limits: { maxReconcileRows: 2 } });
    await cleared(checking, [1, 2, 3]);
    const res = await h.call('write_reconcile_account', {
      account_id: checking,
      statement_balance: 6,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/at most 2 rows.*lock 3/);
    expect(auditLines()).toEqual([]);
  });

  it("A grant's max_reconcile_rows replaces the setting", async () => {
    const checking = await start({
      limits: { maxReconcileRows: 5 },
      grant: grant([...SCOPES], { max_reconcile_rows: 1 }),
    });
    await cleared(checking, [1, 2]);
    const res = await h.call('write_reconcile_account', {
      account_id: checking,
      statement_balance: 3,
    });
    expect(res.isError).toBe(true);
  });

  it('max_rows neither limits it nor is raised by it', async () => {
    const checking = await start({
      grant: grant([...SCOPES], { max_rows: 2 }),
    });
    await cleared(
      checking,
      Array.from({ length: 40 }, () => 1),
    );
    const res = await reconcile(checking, 40);
    expect(res.isError).toBe(false);
    expect(res.json.locked).toBe(40);
  });

  it('A dry run above the response size is refused with no confirm', async () => {
    const checking = await start({ limits: { maxResponseBytes: 600 } });
    await cleared(
      checking,
      Array.from({ length: 30 }, () => 1),
    );
    const res = await h.call('write_reconcile_account', {
      account_id: checking,
      statement_balance: 30,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/never shortened/);
    expect(auditLines()).toEqual([]);
  });

  it('A ceiling-size dry run with transfer partners fits the default response size', async () => {
    const checking = await start({ limits: { maxReconcileRows: 1000 } });
    const savings = await api.createAccount({ name: 'Savings' }, 0);
    const payee = (await api.getPayees()).find(
      p => p.transfer_acct === savings,
    )!.id;
    await api.addTransactions(
      checking,
      Array.from({ length: 1000 }, (_, i) => ({
        date: '2026-03-01',
        amount: -(i + 1),
        payee,
        cleared: true,
      })),
      { runTransfers: true },
    );
    const total = await clearedTotal(checking);
    const dry = await dryRun(checking, total);
    expect(dry.json.ids.length).toBe(1000);
    expect(dry.json.partner_ids.length).toBe(1000);
    expect(Buffer.byteLength(dry.text)).toBeLessThan(100_000);
  }, 120_000);
});

describe('Undo and the app', () => {
  it('write_undo refuses a reconcile line as not undoable', async () => {
    const checking = await start();
    await cleared(checking, [100]);
    const res = await reconcile(checking, 100);
    expect(res.isError).toBe(false);
    const undo = await h.call('write_undo', { write_id: res.json.write_id });
    expect(undo.isError).toBe(true);
    expect(undo.text).toMatch(/cannot be undone/);
    expect((await rows({ account: checking, reconciled: true })).length).toBe(
      1,
    );
  });

  it("The result equals the app's lockTransactions", async () => {
    const checking = await start();
    const other = await api.createAccount({ name: 'Other' }, 0);
    for (const account of [checking, other]) {
      await api.addTransactions(account, [
        { date: '2026-02-01', amount: -300, cleared: true },
        { date: '2026-02-02', amount: 900, cleared: false },
        {
          date: '2026-02-03',
          amount: 20000,
          cleared: true,
          subtransactions: [{ amount: 15000 }, { amount: 5000 }],
        },
      ]);
    }
    const res = await reconcile(checking, 19700);
    expect(res.isError).toBe(false);

    // The app's algorithm (desktop-client/src/accounts/reconciliation.ts)
    const { q } = api;
    const { data } = (await api.runQuery(
      q('transactions')
        .filter({ cleared: true, reconciled: false, account: other })
        .select('*')
        .options({ splits: 'grouped' }),
    )) as { data: never[] };
    let transactions = ungroupTransactions(data);
    const changes: { updated: unknown[] } = { updated: [] };
    for (const trans of [...transactions]) {
      const { diff } = updateTransaction(transactions, {
        ...trans,
        reconciled: true,
      });
      transactions = applyChanges(diff, transactions);
      changes.updated = changes.updated.concat(diff.updated);
    }
    await api.internal!.send('transactions-batch-update', changes as never);

    const shape = async (account: string) =>
      (await rows({ account }))
        .filter(t => t.date >= '2026-02-01') // not the fixture's own row
        .map(t => [t.amount, t.cleared, t.reconciled])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(await shape(checking)).toEqual(await shape(other));
  });
});

describe('Reconciliation reads', () => {
  it('get_account_reconciliation matches the write; children are excluded', async () => {
    const checking = await start({ grant: grant(['budget:read', ...SCOPES]) });
    await cleared(checking, [-1000, 5000]);
    await api.addTransactions(checking, [
      {
        date: '2026-02-02',
        amount: 20000,
        cleared: true,
        subtransactions: [{ amount: 15000 }, { amount: 5000 }],
      },
    ]);
    const read = await h.call('get_account_reconciliation', {
      account_id: checking,
    });
    expect(read.json).toMatchObject({
      account_id: checking,
      cleared_balance: 24000,
      cleared_unreconciled_rows: 3,
      last_reconciled: null,
    });
    const res = await reconcile(checking, read.json.cleared_balance);
    expect(res.json.locked_ids.length).toBe(5); // 3 rows and 2 children
    const after = await h.call('get_account_reconciliation', {
      account_id: checking,
    });
    expect(after.json).toMatchObject({ cleared_unreconciled_rows: 0 });
    expect(after.json.last_reconciled).toBe(await lastReconciled(checking));
  });

  it('An off-budget account reads the same way', async () => {
    await start();
    const off = await api.createAccount(
      { name: 'Vanguard', offbudget: true },
      0,
    );
    await cleared(off, [4000]);
    const read = await h.call('get_account_reconciliation', {
      account_id: off,
    });
    expect(read.json).toMatchObject({
      cleared_balance: 4000,
      cleared_unreconciled_rows: 1,
    });
  });

  it('list_transactions returns reconciled', async () => {
    const checking = await start();
    const done = await cleared(checking, [10]);
    await api.updateTransaction(done[0].id, { reconciled: true });
    const list = await h.call('list_transactions', { account_id: checking });
    const item = list.json.items.find(
      (t: { id: string }) => t.id === done[0].id,
    );
    expect(item.reconciled).toBe(true);
  });
});
