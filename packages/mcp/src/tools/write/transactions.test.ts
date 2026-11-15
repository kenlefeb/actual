import { existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';
import { SCOPES } from '#grants';

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
  category: string | null;
  payee: string | null;
  notes: string | null;
  cleared: boolean;
  reconciled: boolean;
  schedule: string | null;
  transfer_id: string | null;
  parent_id: string | null;
};

const TX_FIELDS = [
  'id',
  'account',
  'date',
  'amount',
  'category',
  'payee',
  'notes',
  'cleared',
  'reconciled',
  'schedule',
  'transfer_id',
  'parent_id',
];

async function rows(filter: Record<string, unknown>) {
  const { data } = (await api.runQuery(
    api
      .q('transactions')
      .filter(filter)
      .options({ splits: 'all' })
      .select(TX_FIELDS)
      .orderBy(['date', 'id']),
  )) as { data: Tx[] };
  return data;
}

async function row(id: string) {
  return (await rows({ id }))[0];
}

function auditLines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

async function transferPayee(account: string) {
  const payees = await api.getPayees();
  return payees.find(p => p.transfer_acct === account)!.id;
}

async function category(name: string) {
  const found = (await api.getCategories()).find(c => c.name === name);
  return found!.id;
}

/** A budget with Checking (the fixture's), Savings, Credit Union and an off-budget account. */
async function setup({ allowReconciled = false } = {}) {
  h = await startHarness(
    { count: 1 },
    allowReconciled
      ? {
          grant: {
            scopes: [...SCOPES],
            confirm_destructive: false,
            allow_reconciled: true,
          },
        }
      : { writes: true },
  );
  const checking = h.fixture.accountId;
  const savings = await api.createAccount({ name: 'Savings' }, 0);
  const creditUnion = await api.createAccount({ name: 'Credit Union' }, 0);
  const vanguard = await api.createAccount(
    { name: 'Vanguard', offbudget: true },
    0,
  );
  return { checking, savings, creditUnion, vanguard };
}

/** A transfer of -50.00 from Checking to Savings, both sides dated 2026-11-10. */
async function transfer(checking: string, savings: string) {
  await api.addTransactions(
    checking,
    [
      {
        date: '2026-11-10',
        amount: -5000,
        payee: await transferPayee(savings),
      },
    ],
    { runTransfers: true },
  );
  const out = (await rows({ account: checking, amount: -5000 }))[0];
  const into = await row(out.transfer_id!);
  return { out, into };
}

/** A deposit split: parent 2,000.00 with children 1,500.00 and 500.00. */
async function split(account: string) {
  await api.addTransactions(account, [
    {
      date: '2026-11-01',
      amount: 200000,
      subtransactions: [{ amount: 150000 }, { amount: 50000 }],
    },
  ]);
  const parent = (await rows({ account, amount: 200000 }))[0];
  const children = await rows({ parent_id: parent.id });
  const first = children.find(t => t.amount === 150000)!;
  const second = children.find(t => t.amount === 50000)!;
  return { parent, first, second };
}

async function snapshot() {
  return rows({});
}

async function expectRefused(args: Record<string, unknown>, text: RegExp) {
  const before = await snapshot();
  const res = await h.call('write_update_transactions', args);
  expect(res.isError).toBe(true);
  expect(res.text).toMatch(text);
  expect(await snapshot()).toEqual(before);
  expect(auditLines()).toEqual([]);
  return res;
}

/** The result's changes for one row, by field. */
function resultChanges(
  res: { json: { items: Array<{ id: string; changes: unknown[] }> } },
  id: string,
) {
  const item = res.json.items.find(i => i.id === id);
  return Object.fromEntries(
    ((item?.changes ?? []) as Array<{ field: string }>).map(c => [c.field, c]),
  );
}

describe('Transaction amount, date, account and cleared edits', () => {
  it('Correcting an opening balance', async () => {
    h = await startHarness({ count: 1 }, { writes: true });
    const account = await api.createAccount(
      { name: 'Shared USAA Savings' },
      20562,
    );
    const [opening] = await rows({ account });
    const balance = await api.getAccountBalance(account);

    const res = await h.call('write_update_transactions', {
      updates: [{ id: opening.id, amount: 55562 }],
    });

    expect(res.isError).toBe(false);
    expect((await row(opening.id)).amount).toBe(55562);
    expect(await api.getAccountBalance(account)).toBe(balance + 35000);
    expect(resultChanges(res, opening.id).amount).toMatchObject({
      before: 20562,
      after: 55562,
    });
  });

  it('Moving a transaction to another account', async () => {
    const { checking, savings } = await setup({ allowReconciled: true });
    const [t] = await rows({ account: checking });
    await api.updateTransaction(t.id, {
      notes: 'rent',
      cleared: true,
      reconciled: true,
    });

    const res = await h.call('write_update_transactions', {
      updates: [{ id: t.id, account_id: savings, allow_reconciled: true }],
    });

    expect(res.isError).toBe(false);
    const after = await row(t.id);
    expect(after).toMatchObject({
      account: savings,
      amount: t.amount,
      date: t.date,
      payee: t.payee,
      notes: 'rent',
      reconciled: false,
    });
  });

  it('Moving to an off-budget account clears the category', async () => {
    const { checking, vanguard } = await setup();
    const rent = await category('Rent');
    const [t] = await rows({ account: checking });
    await api.updateTransaction(t.id, { category: rent });

    const res = await h.call('write_update_transactions', {
      updates: [{ id: t.id, account_id: vanguard }],
    });

    expect(res.isError).toBe(false);
    expect((await row(t.id)).category).toBeNull();
    expect(resultChanges(res, t.id).category_id).toMatchObject({
      before: rent,
      after: null,
    });
  });

  it('A closed account is refused', async () => {
    const { checking } = await setup();
    // An account with history is closed, not deleted
    const closed = await api.createAccount({ name: 'Old' }, 0);
    await api.addTransactions(closed, [
      { date: '2026-01-01', amount: 100 },
      { date: '2026-01-02', amount: -100 },
    ]);
    await api.closeAccount(closed);
    const [t] = await rows({ account: checking });
    await expectRefused(
      { updates: [{ id: t.id, account_id: closed }] },
      /Reopen the account first/,
    );
  });

  it('Marking cleared', async () => {
    const { checking } = await setup();
    const [t] = await rows({ account: checking });
    await api.updateTransaction(t.id, { cleared: false });
    const res = await h.call('write_update_transactions', {
      updates: [{ id: t.id, cleared: true }],
    });
    expect(res.isError).toBe(false);
    expect((await row(t.id)).cleared).toBe(true);
  });
});

describe('Split edits keep the split balanced', () => {
  it('Paycheck split corrected in one call', async () => {
    const { checking } = await setup();
    const s = await split(checking);
    const res = await h.call('write_update_transactions', {
      updates: [
        { id: s.parent.id, amount: 210000 },
        { id: s.first.id, amount: 160000 },
      ],
    });
    expect(res.isError).toBe(false);
    expect((await row(s.parent.id)).amount).toBe(210000);
    expect((await row(s.first.id)).amount).toBe(160000);
    expect((await row(s.second.id)).amount).toBe(50000);
  });

  it('A parent amount alone is refused', async () => {
    const { checking } = await setup();
    const s = await split(checking);
    const res = await expectRefused(
      { updates: [{ id: s.parent.id, amount: 210000 }] },
      /off by 10000 cents/,
    );
    expect(res.text).toContain(s.parent.id);
  });

  it('A date on a child is refused', async () => {
    const { checking } = await setup();
    const s = await split(checking);
    for (const field of [
      { date: '2026-11-14' },
      { cleared: true },
      { account_id: checking },
    ]) {
      await expectRefused(
        { updates: [{ id: s.first.id, ...field }] },
        /Set it on the split parent/,
      );
    }
  });

  it("A parent's date moves its children", async () => {
    const { checking } = await setup();
    const s = await split(checking);
    const res = await h.call('write_update_transactions', {
      updates: [{ id: s.parent.id, date: '2026-11-14' }],
    });
    expect(res.isError).toBe(false);
    for (const t of [s.parent, s.first, s.second]) {
      expect((await row(t.id)).date).toBe('2026-11-14');
    }
  });
});

describe('Transfer edits keep the pair', () => {
  it('Transfer amount', async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    const res = await h.call('write_update_transactions', {
      updates: [{ id: out.id, amount: -7500 }],
    });
    expect(res.isError).toBe(false);
    expect((await row(into.id)).amount).toBe(7500);
    expect(resultChanges(res, out.id).amount).toMatchObject({
      before: -5000,
      after: -7500,
    });
    expect(resultChanges(res, into.id).amount).toMatchObject({
      before: 5000,
      after: 7500,
    });
  });

  it('Transfer date', async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    const res = await h.call('write_update_transactions', {
      updates: [{ id: out.id, date: '2026-11-14' }],
    });
    expect(res.isError).toBe(false);
    expect((await row(out.id)).date).toBe('2026-11-14');
    expect((await row(into.id)).date).toBe('2026-11-10');
  });

  it('Moving a transfer side to another account', async () => {
    const { checking, savings, creditUnion } = await setup();
    const { out, into } = await transfer(checking, savings);
    const res = await h.call('write_update_transactions', {
      updates: [{ id: out.id, account_id: creditUnion }],
    });
    expect(res.isError).toBe(false);
    const payee = await transferPayee(creditUnion);
    expect((await row(into.id)).payee).toBe(payee);
    expect(resultChanges(res, into.id).payee_id).toMatchObject({
      before: await transferPayee(checking),
      after: payee,
    });
  });

  it('Notes follow to the other side', async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    const res = await h.call('write_update_transactions', {
      updates: [{ id: out.id, notes: 'rent share' }],
    });
    expect(res.isError).toBe(false);
    expect((await row(into.id)).notes).toBe('rent share');
    expect(resultChanges(res, into.id).notes).toBeDefined();
  });

  it('A transfer to its own account', async () => {
    const { checking, savings } = await setup();
    const { out } = await transfer(checking, savings);
    await expectRefused(
      { updates: [{ id: out.id, account_id: savings }] },
      /own other account/,
    );
  });
});

describe('Both sides of one transfer', () => {
  it('Both sides of one transfer in one call', async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    await expectRefused(
      {
        updates: [
          { id: out.id, notes: 'a' },
          { id: into.id, notes: 'b' },
        ],
      },
      /two sides of one transfer/,
    );
  });
});

describe('A payee edit never links or unlinks a transfer', () => {
  // The engine would delete the other side, or insert a new one: a create or
  // delete outside the audit line and the delete scope (until sc-4205)
  it('Unlinking a transfer side is refused', async () => {
    const { checking, savings } = await setup();
    const { out } = await transfer(checking, savings);
    const landlord = (await api.getPayees()).find(p => p.name === 'Landlord')!;
    for (const payee_id of [landlord.id, null]) {
      await expectRefused(
        { updates: [{ id: out.id, payee_id }] },
        /link or unlink a transfer; do it in the app/,
      );
    }
  });

  it('Relinking a transfer side to another account is refused', async () => {
    const { checking, savings, creditUnion } = await setup();
    const { out } = await transfer(checking, savings);
    await expectRefused(
      { updates: [{ id: out.id, payee_id: await transferPayee(creditUnion) }] },
      /link or unlink a transfer/,
    );
  });

  it('A transfer payee on an ordinary row is refused', async () => {
    const { checking, savings } = await setup();
    const [t] = await rows({ account: checking });
    await expectRefused(
      { updates: [{ id: t.id, payee_id: await transferPayee(savings) }] },
      /link or unlink a transfer/,
    );
  });

  it("A split parent's transfer payee would reach its children", async () => {
    const { checking, savings } = await setup();
    const s = await split(checking);
    await expectRefused(
      {
        updates: [{ id: s.parent.id, payee_id: await transferPayee(savings) }],
      },
      /link or unlink a transfer/,
    );
  });

  it("A transfer side's own transfer payee is fine", async () => {
    const { checking, savings } = await setup();
    const { out } = await transfer(checking, savings);
    const res = await h.call('write_update_transactions', {
      updates: [{ id: out.id, payee_id: out.payee, notes: 'same payee' }],
    });
    expect(res.isError).toBe(false);
  });
});

describe('Reconciled rows need an explicit override', () => {
  async function reconciled({ allowReconciled = true } = {}) {
    const { checking, savings } = await setup({ allowReconciled });
    const [t] = await rows({ account: checking });
    await api.updateTransaction(t.id, { cleared: true, reconciled: true });
    return { checking, savings, t };
  }

  it('Refused without the override', async () => {
    const { savings, t } = await reconciled();
    const landlord = (await api.getPayees()).find(p => p.name === 'Landlord')!;
    for (const field of [
      { amount: -999 },
      { date: '2026-11-14' },
      { account_id: savings },
      { payee_id: landlord.id },
      { cleared: false },
    ]) {
      const res = await expectRefused(
        { updates: [{ id: t.id, ...field }] },
        /is reconciled; set allow_reconciled/,
      );
      expect(res.text).toContain(t.id);
    }
  });

  it("Refused when the transfer's other side is reconciled", async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    await api.updateTransaction(into.id, { cleared: true, reconciled: true });
    await expectRefused(
      { updates: [{ id: out.id, amount: -7500 }] },
      /is reconciled; set allow_reconciled/,
    );
  });

  it('Allowed with the override', async () => {
    const { t } = await reconciled();
    const res = await h.call('write_update_transactions', {
      updates: [{ id: t.id, amount: -999, allow_reconciled: true }],
    });
    expect(res.isError).toBe(false);
    expect((await row(t.id)).amount).toBe(-999);
    expect(auditLines()[0].changes).toContainEqual({
      id: t.id,
      field: 'allow_reconciled',
      before: null,
      after: true,
    });
    expect(res.json.reconciled_overridden).toEqual([t.id]);
  });

  it("An override the grant doesn't allow is refused", async () => {
    const { t } = await reconciled({ allowReconciled: false });
    for (const update of [
      { id: t.id, amount: -999, allow_reconciled: true },
      // Even where the row would not need it
      { id: t.id, notes: 'checked', allow_reconciled: true },
    ]) {
      await expectRefused(
        { updates: [update] },
        /grant does not allow overriding reconciled/,
      );
    }
  });

  it('The audit line records only an override actually used', async () => {
    const { checking } = await setup({ allowReconciled: true });
    const [t] = await rows({ account: checking });
    const res = await h.call('write_update_transactions', {
      updates: [{ id: t.id, amount: -999, allow_reconciled: true }],
    });
    expect(res.isError).toBe(false);
    expect(
      auditLines()[0].changes.filter(
        (c: { field: string }) => c.field === 'allow_reconciled',
      ),
    ).toEqual([]);
    expect(res.json.reconciled_overridden).toBeUndefined();
  });

  it("An override of the transfer's other side is recorded on that side", async () => {
    const { checking, savings } = await setup({ allowReconciled: true });
    const { out, into } = await transfer(checking, savings);
    await api.updateTransaction(into.id, { cleared: true, reconciled: true });
    const res = await h.call('write_update_transactions', {
      updates: [{ id: out.id, amount: -7500, allow_reconciled: true }],
    });
    expect(res.isError).toBe(false);
    expect(auditLines()[0].changes).toContainEqual({
      id: into.id,
      field: 'allow_reconciled',
      before: null,
      after: true,
    });
    expect(res.json.reconciled_overridden).toEqual([into.id]);
  });

  it("A split child's reconciled transfer partner needs the override", async () => {
    const { checking, savings, creditUnion } = await setup();
    await api.addTransactions(checking, [
      {
        date: '2026-11-01',
        amount: -10000,
        subtransactions: [{ amount: -6000 }, { amount: -4000 }],
      },
    ]);
    const parent = (await rows({ account: checking, amount: -10000 }))[0];
    const first = (await rows({ parent_id: parent.id })).find(
      t => t.amount === -6000,
    )!;
    // The engine links the child to Savings
    await api.updateTransaction(first.id, {
      payee: await transferPayee(savings),
    });
    const child = await row(first.id);
    expect(child.transfer_id).toBeTruthy();
    await api.updateTransaction(child.transfer_id!, {
      cleared: true,
      reconciled: true,
    });
    await expectRefused(
      { updates: [{ id: parent.id, account_id: creditUnion }] },
      /is reconciled; set allow_reconciled/,
    );
  });

  it('Unlocking a reconciled row', async () => {
    const { t } = await reconciled();
    const res = await h.call('write_update_transactions', {
      updates: [{ id: t.id, cleared: false, allow_reconciled: true }],
    });
    expect(res.isError).toBe(false);
    expect(await row(t.id)).toMatchObject({
      cleared: false,
      reconciled: false,
    });
  });

  it('Category and notes need no override', async () => {
    const { t } = await reconciled();
    const rent = await category('Rent');
    const res = await h.call('write_update_transactions', {
      updates: [{ id: t.id, category_id: rent, notes: 'checked' }],
    });
    expect(res.isError).toBe(false);
    expect(await row(t.id)).toMatchObject({
      category: rent,
      notes: 'checked',
      reconciled: true,
    });
  });
});

describe('Schedule-linked rows keep their link', () => {
  it('Editing a paycheck deposit', async () => {
    const { checking } = await setup();
    await api.createPaycheck({
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
          { id: 'checking', account: checking, kind: 'remainder', value: 0 },
        ],
      },
    });
    const schedule = (await api.getSchedules())[0];
    const [t] = await rows({ account: checking });
    await api.updateTransaction(t.id, { schedule: schedule.id });
    const schedules = await api.getSchedules();
    const paychecks = await api.getPaychecks();

    const res = await h.call('write_update_transactions', {
      updates: [{ id: t.id, amount: 299000 }],
    });

    expect(res.isError).toBe(false);
    expect(await row(t.id)).toMatchObject({
      amount: 299000,
      schedule: schedule.id,
    });
    expect(await api.getSchedules()).toEqual(schedules);
    expect(await api.getPaychecks()).toEqual(paychecks);
  });
});

describe('Moved history is checked after the edit', () => {
  it('Dating a categorized row into moved history', async () => {
    h = await startHarness({ count: 1 }, { writes: true });
    const account = await api.createAccount(
      { name: 'Brokerage', offbudget: true },
      0,
    );
    await api.addTransactions(account, [{ date: '2026-10-05', amount: 400 }]);
    await api.moveAccountOnBudget(account, '2026-10-01');
    const late = (await rows({ account, date: '2026-10-05' }))[0];
    await api.updateTransaction(late.id, { category: await category('Rent') });
    await expectRefused(
      { updates: [{ id: late.id, date: '2026-09-20' }] },
      /in the app/,
    );
  });
});

describe('Cascaded changes are audited', () => {
  function attempt() {
    return auditLines().find(l => l.phase === 'attempt');
  }

  it('The transfer partner is in the audit line', async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    await h.call('write_update_transactions', {
      updates: [{ id: out.id, amount: -7500 }],
    });
    expect(attempt().changes).toEqual(
      expect.arrayContaining([
        { id: out.id, field: 'amount', before: -5000, after: -7500 },
        { id: into.id, field: 'amount', before: 5000, after: 7500 },
      ]),
    );
  });

  it('A notes edit on a transfer is audited on both sides', async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    await h.call('write_update_transactions', {
      updates: [{ id: out.id, notes: 'rent share' }],
    });
    expect(attempt().changes).toEqual(
      expect.arrayContaining([
        { id: out.id, field: 'notes', before: null, after: 'rent share' },
        { id: into.id, field: 'notes', before: null, after: 'rent share' },
      ]),
    );
  });

  it.each([
    [1, true],
    [2, false],
  ])(
    'The row cap counts every row the call changes (max_rows %i)',
    async (maxRows, refused) => {
      h = await startHarness(
        { count: 1 },
        {
          grant: {
            scopes: [...SCOPES],
            confirm_destructive: false,
            max_rows: maxRows,
          },
        },
      );
      const checking = h.fixture.accountId;
      const savings = await api.createAccount({ name: 'Savings' }, 0);
      const { out, into } = await transfer(checking, savings);
      // One named row, two changed: the side and its partner
      const args = { updates: [{ id: out.id, amount: -7500 }] };
      if (refused) {
        await expectRefused(args, /At most 1 rows may change/);
      } else {
        const res = await h.call('write_update_transactions', args);
        expect(res.isError).toBe(false);
        expect((await row(into.id)).amount).toBe(7500);
      }
    },
  );

  it('A row named twice is refused before the cap', async () => {
    h = await startHarness(
      { count: 1 },
      {
        grant: { scopes: [...SCOPES], confirm_destructive: false, max_rows: 2 },
      },
    );
    const [t] = await rows({ account: h.fixture.accountId });
    await expectRefused(
      {
        updates: [
          { id: t.id, notes: 'a' },
          { id: t.id, notes: 'b' },
        ],
      },
      /may appear only once/,
    );
  });

  it('A split parent and its own child count once each toward the cap', async () => {
    h = await startHarness(
      { count: 1 },
      {
        grant: { scopes: [...SCOPES], confirm_destructive: false, max_rows: 3 },
      },
    );
    const s = await split(h.fixture.accountId);
    // Five field changes on three rows: the parent, the named child and the
    // child that follows the parent's date
    const res = await h.call('write_update_transactions', {
      updates: [
        { id: s.parent.id, amount: 210000, date: '2026-11-14' },
        { id: s.first.id, amount: 160000 },
      ],
    });
    expect(res.isError).toBe(false);
    const changes = auditLines()[0].changes as Array<{ id: string }>;
    expect(changes.length).toBeGreaterThan(3);
    expect(new Set(changes.map(c => c.id)).size).toBe(3);
    expect((await row(s.second.id)).date).toBe('2026-11-14');
  });

  // The prediction must match what the engine does
  const COLUMN: Record<string, keyof Tx> = {
    amount: 'amount',
    date: 'date',
    account_id: 'account',
    cleared: 'cleared',
    category_id: 'category',
    payee_id: 'payee',
    notes: 'notes',
    schedule: 'schedule',
    reconciled: 'reconciled',
  };

  async function expectPredicted() {
    const changes = attempt().changes as Array<{
      id: string;
      field: string;
      after: unknown;
    }>;
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes.filter(c => c.field in COLUMN)) {
      expect({ ...c, now: (await row(c.id))[COLUMN[c.field]] }).toEqual({
        ...c,
        now: c.after,
      });
    }
  }

  it.each([
    ['transfer amount', 'amount'],
    ['transfer account move', 'account'],
    ['transfer notes', 'notes'],
    ['off-budget move', 'offbudget'],
    ['split', 'split'],
  ])('Prediction matches the read-back: %s', async (_, kind) => {
    const { checking, savings, creditUnion, vanguard } = await setup();
    const rent = await category('Rent');
    let updates: Array<Record<string, unknown>>;
    if (kind === 'offbudget') {
      const [t] = await rows({ account: checking });
      await api.updateTransaction(t.id, { category: rent });
      updates = [{ id: t.id, account_id: vanguard }];
    } else if (kind === 'split') {
      const s = await split(checking);
      updates = [
        { id: s.parent.id, amount: 210000, date: '2026-11-14', cleared: true },
        { id: s.first.id, amount: 160000 },
      ];
    } else {
      const { out } = await transfer(checking, savings);
      updates = [
        kind === 'amount'
          ? { id: out.id, amount: -7500 }
          : kind === 'account'
            ? { id: out.id, account_id: creditUnion }
            : { id: out.id, notes: 'rent share' },
      ];
    }
    const before = await snapshot();
    const res = await h.call('write_update_transactions', { updates });
    expect(res.isError).toBe(false);
    await expectPredicted();
    // Nothing outside the predicted change set moved
    const predicted = new Set(
      (attempt().changes as Array<{ id: string; field: string }>).map(
        c => `${c.id}:${c.field}`,
      ),
    );
    for (const old of before) {
      const now = await row(old.id);
      for (const [field, column] of Object.entries(COLUMN)) {
        if (now[column] !== old[column]) {
          expect(predicted).toContain(`${old.id}:${field}`);
        }
      }
    }
  });
});

describe('Multi-row updates apply together', () => {
  it('A failure partway', async () => {
    h = await startHarness({ count: 3 }, { writes: true });
    const all = await rows({ account: h.fixture.accountId });
    // The engine rejects the batch at its second row: nothing is written
    vi.spyOn(api, 'updateTransactions').mockRejectedValue(
      new Error('engine rejected the second row'),
    );
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const res = await h.call('write_update_transactions', {
      updates: all.map(t => ({ id: t.id, notes: 'changed' })),
    });
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({ applied: [] });
    expect(
      (await rows({ account: h.fixture.accountId })).map(t => t.notes),
    ).toEqual(all.map(t => t.notes));
    expect(auditLines()[1]).toMatchObject({
      phase: 'outcome',
      status: 'failed',
      applied: [],
    });
  });

  it('The transfer step fails', async () => {
    const { checking, savings } = await setup();
    const { out, into } = await transfer(checking, savings);
    // Checking loses its transfer payee, so the engine's transfer step throws
    await api.updatePayee(await transferPayee(checking), {
      transfer_acct: null,
    } as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const res = await h.call('write_update_transactions', {
      updates: [{ id: out.id, amount: -7500 }],
    });

    expect(res.isError).toBe(false);
    expect((await row(out.id)).amount).toBe(-7500);
    expect((await row(into.id)).amount).toBe(5000);
    expect(res.json).toMatchObject({
      applied: [out.id],
      partners_not_updated: [into.id],
    });
    expect(auditLines()[1]).toMatchObject({
      phase: 'outcome',
      status: 'failed',
      applied: [out.id],
      partners_not_updated: [into.id],
    });
  });

  it("An engine failure whose state can't be read back", async () => {
    h = await startHarness({ count: 1 }, { writes: true });
    const [t] = await rows({ account: h.fixture.accountId });
    vi.spyOn(api, 'updateTransactions').mockImplementation(async () => {
      // From here on, every read fails too
      vi.spyOn(api, 'runQuery').mockRejectedValue(new Error('read failed'));
      throw new Error('engine failed');
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const res = await h.call('write_update_transactions', {
      updates: [{ id: t.id, notes: 'changed' }],
    });
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({ applied: null, read_back: 'failed' });
    expect(res.json.failure).toMatch(/Check the budget/);
    expect(auditLines()[1]).toMatchObject({
      phase: 'outcome',
      status: 'failed',
      applied: null,
      read_back: 'failed',
    });
  });

  it('An engine failure is logged to stderr only', async () => {
    h = await startHarness({ count: 2 }, { writes: true });
    const all = await rows({ account: h.fixture.accountId });
    vi.spyOn(api, 'updateTransactions').mockRejectedValue(
      new Error(`engine said ${h.secret}`),
    );
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const res = await h.call('write_update_transactions', {
      updates: all.map(t => ({ id: t.id, notes: 'changed' })),
    });
    const logged = stderr.mock.calls.map(c => String(c[0])).join('');
    expect(logged).toContain('write_update_transactions');
    expect(logged).toContain(auditLines()[0].call_id);
    expect(logged).toContain('engine said [redacted]');
    expect(logged).not.toContain(h.secret);
    expect(res.text).not.toContain('engine said');
    expect(readFileSync(h.auditLog, 'utf8')).not.toContain('engine said');
  });
});
