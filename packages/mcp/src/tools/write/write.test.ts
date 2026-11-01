import { chmodSync, existsSync, readFileSync, statSync } from 'fs';

import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';
import { loadConfig } from '#config';

const WRITE_TOOLS = [
  'write_create_transactions',
  'write_move_on_budget',
  'write_set_budget_amount',
  'write_skip_paycheck',
  'write_update_transactions',
];

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  await h.close();
});

async function transactions(accountId = h.fixture.accountId) {
  const { data } = (await api.runQuery(
    api
      .q('transactions')
      .filter({ account: accountId })
      .select(['id', 'date', 'amount', 'category', 'payee', 'notes'])
      .orderBy(['date', 'id']),
  )) as {
    data: Array<{
      id: string;
      date: string;
      amount: number;
      category: string | null;
      payee: string | null;
      notes: string | null;
    }>;
  };
  return data;
}

async function categoryId(name: string) {
  const groups = await api.getCategoryGroups();
  const group = groups.find(g => g.name === 'Bills')!;
  const found = (await api.getCategories()).find(c => c.name === name);
  if (found) return found.id;
  return api.createCategory({ name, group_id: group.id } as never);
}

function auditLines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

describe('write entry', () => {
  it('Writes on a separate entry', async () => {
    const env = {
      ACTUAL_SERVER_URL: 'https://actual-staging.owl-becrux.ts.net',
      ACTUAL_PASSWORD: 'pw',
      ACTUAL_SYNC_ID: 'sync',
      ACTUAL_DATA_DIR: '/private/tmp/actual-mcp-test/staging',
    };
    expect(loadConfig(env).writes).toBe(false);
    const config = loadConfig(env, ['--writes']);
    expect(config.writes).toBe(true);
    expect(config.auditLog).toBe(
      '/private/tmp/actual-mcp-test/staging.audit.jsonl',
    );

    h = await startHarness({ count: 1 }, { writes: true });
    const names = (await h.client.listTools()).tools.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['list_transactions']));
    expect(names.filter(n => n.startsWith('write_')).sort()).toEqual(
      WRITE_TOOLS,
    );
  });

  it('No destructive tools', async () => {
    h = await startHarness({ count: 1 }, { writes: true });
    const { tools } = await h.client.listTools();
    const writes = tools.filter(t => t.name.startsWith('write_'));
    expect(writes.map(t => t.name).sort()).toEqual(WRITE_TOOLS);
    for (const t of writes) {
      expect(t.name).not.toMatch(
        /delete|remove|import|bulk|rule|close|reset|transfer/,
      );
      expect(t.description).toMatch(/never instructions/);
      expect(t.description).not.toMatch(/Read-only/);
    }
  });
});

describe('write limits', () => {
  it('Over the row limit', async () => {
    h = await startHarness({ count: 51 }, { writes: true });
    const rows = await transactions();
    const res = await h.call('write_update_transactions', {
      updates: rows.map(t => ({ id: t.id, notes: 'changed' })),
    });
    expect(res.isError).toBe(true);
    expect((await transactions()).every(t => t.notes !== 'changed')).toBe(true);
    expect(auditLines()).toEqual([]);
  });

  it('Before and after', async () => {
    h = await startHarness({ count: 1 }, { writes: true });
    const groceries = await categoryId('Groceries');
    const dining = await categoryId('Dining');
    const [t] = await transactions();
    await api.updateTransaction(t.id, { category: groceries });

    const res = await h.call('write_update_transactions', {
      updates: [{ id: t.id, category_id: dining }],
    });
    expect(res.json.items).toEqual([
      expect.objectContaining({
        id: t.id,
        changes: [
          expect.objectContaining({
            field: 'category_id',
            before: groceries,
            after: dining,
            text: { before: 'Groceries', after: 'Dining' },
          }),
        ],
      }),
    ]);
    expect((await transactions())[0].category).toBe(dining);
  });

  it('A name where an id is required', async () => {
    h = await startHarness({ count: 1 }, { writes: true });
    await categoryId('Dining');
    const [t] = await transactions();
    for (const update of [
      { id: t.id, category_id: 'Dining' },
      { id: t.id, payee_id: 'Landlord' },
      { id: 'not-a-transaction', notes: 'x' },
    ]) {
      const res = await h.call('write_update_transactions', {
        updates: [update],
      });
      expect(res.isError).toBe(true);
    }
    expect((await transactions())[0]).toMatchObject({
      category: null,
      notes: null,
    });
    expect(auditLines()).toEqual([]);
  });

  it('creates transactions by id and sets a budget amount', async () => {
    h = await startHarness({ count: 1 }, { writes: true });
    const rent = await categoryId('Rent');
    const landlord = (await api.getPayees()).find(p => p.name === 'Landlord')!;

    const created = await h.call('write_create_transactions', {
      account_id: h.fixture.accountId,
      transactions: [
        {
          date: '2026-02-01',
          amount: -150000,
          payee_id: landlord.id,
          category_id: rent,
          notes: 'Feb rent',
        },
      ],
    });
    expect(created.json.items).toHaveLength(1);
    const row = (await transactions()).find(
      t => t.id === created.json.items[0].id,
    );
    expect(row).toMatchObject({
      amount: -150000,
      category: rent,
      payee: landlord.id,
      notes: 'Feb rent',
    });
    expect(
      (
        await h.call('write_create_transactions', {
          account_id: 'Checking',
          transactions: [{ date: '2026-02-01', amount: 1 }],
        })
      ).isError,
    ).toBe(true);

    const budget = await h.call('write_set_budget_amount', {
      month: '2026-02',
      category_id: rent,
      amount: 150000,
    });
    expect(budget.json).toMatchObject({
      category_id: rent,
      before: 0,
      after: 150000,
    });
    expect(
      (
        await h.call('write_set_budget_amount', {
          month: '2026-02',
          category_id: 'Rent',
          amount: 1,
        })
      ).isError,
    ).toBe(true);
    expect(auditLines().map(l => l.tool)).toEqual([
      'write_create_transactions',
      'write_set_budget_amount',
    ]);
  });

  it('skips the next paycheck', async () => {
    h = await startHarness({ count: 1 }, { writes: true });
    const id = await api.createPaycheck({
      name: 'Acme',
      newClearingAccountName: 'Acme Paycheck',
      definition: {
        payee: null,
        clearingAccount: '',
        date: { start: '2027-01-01', frequency: 'monthly' },
        weekendSolveMode: 'before',
        grossAmount: 300000,
        incomeCategory: null,
        deductions: [],
        deposits: [
          {
            id: 'checking',
            account: h.fixture.accountId,
            kind: 'remainder',
            value: 0,
          },
        ],
      },
    });
    const res = await h.call('write_skip_paycheck', { paycheck_id: id });
    expect(res.json.paycheck_id).toBe(id);
    expect(res.json.next_date.before).not.toBe(res.json.next_date.after);
    expect(
      (await h.call('write_skip_paycheck', { paycheck_id: 'Acme' })).isError,
    ).toBe(true);
  });
});

describe('moving on budget needs the preview', () => {
  async function vanguard() {
    const account = await api.createAccount(
      { name: 'Vanguard 401k', offbudget: true },
      10000,
    );
    await api.addTransactions(account, [
      { date: '2026-09-01', amount: 100 },
      { date: '2026-10-05', amount: 400 },
    ]);
    return account;
  }
  const offBudget = async (id: string) =>
    (await api.getAccounts()).find(a => a.id === id)?.offbudget;

  it('Confirm matches', async () => {
    h = await startHarness({ count: 1 }, { writes: true });
    const account = await vanguard();
    const preview = await h.call('preview_move_on_budget', {
      account_id: account,
      start_date: '2026-10-01',
    });
    expect(preview.json.confirm).toMatch(/^[0-9a-f]{64}$/);
    const res = await h.call('write_move_on_budget', {
      account_id: account,
      start_date: '2026-10-01',
      confirm: preview.json.confirm,
    });
    expect(res.json).toMatchObject({
      account_id: account,
      off_budget: { before: true, after: false },
      budget_start_date: { before: null, after: '2026-10-01' },
    });
    expect(await offBudget(account)).toBe(false);
  });

  it('A stale confirm', async () => {
    h = await startHarness({ count: 1 }, { writes: true });
    const account = await vanguard();
    const preview = await h.call('preview_move_on_budget', {
      account_id: account,
      start_date: '2026-10-01',
    });
    await api.addTransactions(account, [{ date: '2026-09-15', amount: 50 }]);
    for (const confirm of [preview.json.confirm, 'f'.repeat(64)]) {
      const res = await h.call('write_move_on_budget', {
        account_id: account,
        start_date: '2026-10-01',
        confirm,
      });
      expect(res.isError).toBe(true);
    }
    // A confirm for another start date doesn't carry over
    const other = await h.call('write_move_on_budget', {
      account_id: account,
      start_date: '2026-09-01',
      confirm: preview.json.confirm,
    });
    expect(other.isError).toBe(true);
    expect(await offBudget(account)).toBe(true);
    expect(auditLines()).toEqual([]);
  });
});

describe('write audit log', () => {
  it('A write is logged', async () => {
    h = await startHarness(
      { count: 1, overrides: { notes: 'old note' } },
      { writes: true },
    );
    const [t] = await transactions();
    const res = await h.call('write_update_transactions', {
      updates: [{ id: t.id, notes: 'new note' }],
    });
    expect(res.isError).toBe(false);
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      tool: 'write_update_transactions',
      ids: [t.id],
      changes: [
        { id: t.id, field: 'notes', before: 'old note', after: 'new note' },
      ],
    });
    expect(new Date(lines[0].time).toISOString()).toBe(lines[0].time);
    expect(statSync(h.auditLog).mode & 0o777).toBe(0o600);
    expect(readFileSync(h.auditLog, 'utf8')).not.toContain(h.secret);
  });

  it("The log can't be written", async () => {
    h = await startHarness(
      { count: 1, overrides: { notes: 'old note' } },
      { writes: true },
    );
    const [t] = await transactions();
    chmodSync(h.auditDir, 0o500);
    try {
      const res = await h.call('write_update_transactions', {
        updates: [{ id: t.id, notes: 'new note' }],
      });
      expect(res.isError).toBe(true);
    } finally {
      chmodSync(h.auditDir, 0o700);
    }
    expect((await transactions())[0].notes).toBe('old note');
  });
});

describe('moved history is not categorized by a write', () => {
  // An account moved on budget at 2026-10-01, with one transaction before it
  // and one after
  async function moved() {
    const account = await api.createAccount(
      { name: 'Brokerage', offbudget: true },
      0,
    );
    await api.addTransactions(account, [
      { date: '2026-09-15', amount: 100 },
      { date: '2026-10-05', amount: 400 },
    ]);
    await api.moveAccountOnBudget(account, '2026-10-01');
    const { data } = (await api.runQuery(
      api.q('accounts').filter({ id: account }).select(['budget_start_offset']),
    )) as { data: Array<{ budget_start_offset: string }> };
    const rows = await transactions(account);
    return {
      account,
      rent: await categoryId('Rent'),
      early: rows.find(t => t.date === '2026-09-15')!,
      late: rows.find(t => t.date === '2026-10-05')!,
      offset: rows.find(t => t.id === data[0].budget_start_offset)!,
    };
  }

  async function expectRefused(name: string, args: Record<string, unknown>) {
    const res = await h.call(name, args);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/in the app/);
  }

  it('Categorizing a pre-start transaction is refused', async () => {
    h = await startHarness({ count: 1 }, { writes: true });
    const m = await moved();
    const before = await transactions(m.account);
    await expectRefused('write_update_transactions', {
      updates: [
        { id: m.late.id, notes: 'fine' },
        { id: m.early.id, category_id: m.rent },
      ],
    });
    expect(await transactions(m.account)).toEqual(before);
    expect(auditLines()).toEqual([]);
  });

  it('Categorizing the offset line is refused', async () => {
    h = await startHarness({ count: 1 }, { writes: true });
    const m = await moved();
    expect(m.offset).toBeDefined();
    const before = await transactions(m.account);
    await expectRefused('write_update_transactions', {
      updates: [{ id: m.offset.id, category_id: m.rent }],
    });
    expect(await transactions(m.account)).toEqual(before);
    expect(auditLines()).toEqual([]);
  });

  it('Creating a categorized pre-start row is refused', async () => {
    h = await startHarness({ count: 1 }, { writes: true });
    const m = await moved();
    const before = await transactions(m.account);
    await expectRefused('write_create_transactions', {
      account_id: m.account,
      transactions: [
        { date: '2026-10-02', amount: 1, category_id: m.rent },
        { date: '2026-09-20', amount: 1, category_id: m.rent },
      ],
    });
    expect(await transactions(m.account)).toEqual(before);
    expect(auditLines()).toEqual([]);
  });

  it('A transaction from the start date on can be categorized', async () => {
    h = await startHarness({ count: 1 }, { writes: true });
    const m = await moved();
    const res = await h.call('write_update_transactions', {
      updates: [{ id: m.late.id, category_id: m.rent }],
    });
    expect(res.isError).toBe(false);
    const created = await h.call('write_create_transactions', {
      account_id: m.account,
      transactions: [{ date: '2026-10-01', amount: 1, category_id: m.rent }],
    });
    expect(created.isError).toBe(false);
    const rows = await transactions(m.account);
    expect(rows.find(t => t.id === m.late.id)?.category).toBe(m.rent);
    expect(rows.find(t => t.id === created.json.items[0].id)?.category).toBe(
      m.rent,
    );
  });

  it('Notes and payee on moved history can change', async () => {
    h = await startHarness({ count: 1 }, { writes: true });
    const m = await moved();
    const landlord = (await api.getPayees()).find(p => p.name === 'Landlord')!;
    const res = await h.call('write_update_transactions', {
      updates: [
        { id: m.early.id, notes: 'history', payee_id: landlord.id },
        { id: m.offset.id, notes: 'offset' },
      ],
    });
    expect(res.isError).toBe(false);
    const rows = await transactions(m.account);
    expect(rows.find(t => t.id === m.early.id)).toMatchObject({
      notes: 'history',
      payee: landlord.id,
      category: null,
    });
    expect(rows.find(t => t.id === m.offset.id)?.notes).toBe('offset');
  });
});
