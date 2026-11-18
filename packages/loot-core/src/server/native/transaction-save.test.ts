// Fork-only (sc-3602, openspec/changes/native-add-transaction D3). The
// contract for the native Add transaction sheet's save: checked whole before
// anything is written, one undo step carrying Swift's token, and a repeated
// add never stores twice.
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';
import { app as schedulesApp } from '#server/schedules/app';
import { batchUpdateTransactions } from '#server/transactions';
import {
  insertRule,
  loadRules,
  updateRule,
} from '#server/transactions/transaction-rules';
import { clearUndo } from '#server/undo';

import { app } from './app';
import { transactionDigest } from './transaction-form';

const h = app.handlers;
const NEW_ID = '0b5f2c1e-8d3a-4f6b-9c2d-1a2b3c4d5e6f';
const OTHER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const draft = (over: Record<string, unknown> = {}) => ({
  newId: NEW_ID,
  account: 'checking',
  date: '2016-12-20',
  payee: null,
  payeeName: null,
  category: null,
  notes: '',
  cleared: false,
  inflow: false,
  amountText: '10',
  splits: [],
  userFields: [],
  ...over,
});
const save = (over: Record<string, unknown> = {}) =>
  h['native/transaction-save']({
    draft: draft(),
    undoToken: 'T',
    ...over,
  } as never);
const saveDraft = (d: Record<string, unknown>, over = {}) =>
  save({ draft: d, ...over });
const undo = (token = 'T') => h['native/undo']({ token });
const form = (id: string) => h['native/transaction-form']({ id });
const setPref = (id: string, value: string) =>
  db.update('preferences', { id, value });

type Row = {
  id: string;
  acct: string;
  date: number;
  amount: number;
  description: string | null;
  category: string | null;
  notes: string | null;
  cleared: number;
  reconciled: number;
  tombstone: number;
  isParent: number;
  isChild: number;
  parent_id: string | null;
  transferred_id: string | null;
};
const row = (id: string) =>
  db.first<Row>('SELECT * FROM transactions WHERE id = ?', [id]);
const live = () =>
  db.all<Row>(
    'SELECT * FROM transactions WHERE tombstone = 0 ORDER BY sort_order, id',
  );
const count = async (table: string) =>
  (
    await db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE tombstone = 0`,
    )
  )?.n;

async function addAccount(id: string, name: string, over = {}) {
  await db.insertAccount({ id, name, ...over });
  await db.insertPayee({ id: `to-${id}`, name, transfer_acct: id });
}

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  await loadMappings();
  await loadRules();
  schedulesApp.startServices();
  await addAccount('checking', 'Checking');
  await addAccount('savings', 'Savings');
  await addAccount('house', 'House', { offbudget: 1 });
  await addAccount('boat', 'Boat', { offbudget: 1 });
  await addAccount('old', 'Old', { closed: 1 });
  await db.insertCategoryGroup({ id: 'food-group', name: 'Food' });
  for (const [id, name, hidden] of [
    ['groceries', 'Groceries', 0],
    ['dining', 'Dining', 0],
    ['household', 'Household', 0],
    ['secret', 'Secret', 1],
  ] as const) {
    await db.insertCategory({ id, name, cat_group: 'food-group', hidden });
  }
  await db.insertPayee({ id: 'costco', name: 'Costco' });
  clearUndo();
});

async function costcoRule(category = 'groceries') {
  return insertRule({
    stage: null,
    conditionsOp: 'and',
    conditions: [{ op: 'is', field: 'payee', value: 'costco' }],
    actions: [{ op: 'set', field: 'category', value: category }],
  });
}

describe('native/transaction-save: an add', () => {
  it('stores the draft as one undo step and returns the new id', async () => {
    const result = await save({
      draft: draft({ amountText: '12.50+3*2', notes: 'Lunch', cleared: true }),
    });
    expect(result).toEqual({ id: NEW_ID });
    expect(await row(NEW_ID)).toMatchObject({
      acct: 'checking',
      date: 20161220,
      amount: -1850,
      notes: 'Lunch',
      cleared: 1,
      reconciled: 0,
      isParent: 0,
    });
    await undo();
    expect((await row(NEW_ID))?.tombstone).toBe(1);
  });

  it('stores a new split with a new payee, and one undo removes all of it', async () => {
    await save({
      draft: draft({
        payeeName: 'Corner Bakery',
        amountText: '30',
        splits: [
          {
            category: 'groceries',
            notes: 'Bread',
            inflow: false,
            amountText: '10',
          },
          { category: 'dining', notes: '', inflow: false, amountText: '20' },
        ],
      }),
    });
    const rows = await live();
    expect(rows).toHaveLength(3);
    const children = rows.filter(r => r.isChild);
    expect(
      children
        .sort((a, b) => a.amount - b.amount)
        .map(c => [c.amount, c.category]),
    ).toEqual([
      [-2000, 'dining'],
      [-1000, 'groceries'],
    ]);
    expect(children.every(c => c.parent_id === NEW_ID)).toBe(true);
    const payee = await db.first<{ id: string }>(
      "SELECT id FROM payees WHERE name = 'Corner Bakery' AND tombstone = 0",
    );
    expect(payee).toBeTruthy();
    expect((await row(NEW_ID))?.description).toBe(payee?.id);

    await undo();
    expect(await live()).toEqual([]);
    expect(
      await db.first(
        "SELECT id FROM payees WHERE name = 'Corner Bakery' AND tombstone = 0",
      ),
    ).toBeNull();
  });

  it("stores what transactions-batch-update stores for the web form's same input", async () => {
    await save({
      draft: draft({
        payee: 'costco',
        category: 'groceries',
        notes: 'n',
        cleared: true,
      }),
    });
    await batchUpdateTransactions({
      added: [
        {
          id: OTHER_ID,
          account: 'checking',
          date: '2016-12-20',
          payee: 'costco',
          category: 'groceries',
          notes: 'n',
          cleared: true,
          amount: -1000,
        },
      ] as never,
      learnCategories: true,
    });
    const strip = ({
      id: _id,
      sort_order: _s,
      ...rest
    }: Row & { sort_order?: number }) => rest;
    expect(strip((await row(NEW_ID)) as Row)).toEqual(
      strip((await row(OTHER_ID)) as Row),
    );
  });

  it('refuses a missing undo token, a missing id and a wrong shape with invalid-draft, storing nothing', async () => {
    const cases = [
      { undoToken: undefined },
      { undoToken: '' },
      { undoToken: 5 },
      { draft: draft({ newId: undefined }) },
      { draft: draft({ reconciled: true }) },
      { draft: draft({ imported_id: 'x' }) },
      { draft: draft({ tombstone: 1 }) },
      { draft: draft({ cleared: 'yes' }) },
      { draft: null },
    ];
    for (const over of cases) {
      await expect(save(over)).rejects.toThrow(/^\[native:invalid-draft\] /);
    }
    expect(await live()).toEqual([]);
  });

  it.each(['ABC', '../x', NEW_ID.toUpperCase(), 'a'.repeat(500)])(
    'refuses the new id %s',
    async newId => {
      await expect(save({ draft: draft({ newId }) })).rejects.toThrow(
        /^\[native:invalid-draft\] /,
      );
      expect(await live()).toEqual([]);
    },
  );
});

describe('native/transaction-save: a repeated add', () => {
  it('returns the id and writes nothing, including after the engine restarts', async () => {
    await save();
    // A restart: the undo history and loaded state go; the row stays
    clearUndo();
    await prefs.loadPrefs();
    await loadMappings();
    await loadRules();
    expect(await save({ undoToken: 'T2' })).toEqual({ id: NEW_ID });
    expect(await live()).toHaveLength(1);
  });

  it('matches a new payee name to the payee the first save created', async () => {
    await save({ draft: draft({ payeeName: 'Corner Bakery' }) });
    expect(
      await save({ draft: draft({ payeeName: 'Corner Bakery' }) }),
    ).toEqual({ id: NEW_ID });
    expect(await count('payees')).toBe(7);
  });

  it('refuses a different draft with invalid-draft and keeps the first', async () => {
    await save();
    await expect(save({ draft: draft({ amountText: '11' }) })).rejects.toThrow(
      /^\[native:invalid-draft\] /,
    );
    expect((await row(NEW_ID))?.amount).toBe(-1000);
  });

  it('refuses after the save was undone or deleted, with changed-since and no id', async () => {
    await save();
    await undo();
    await expect(save()).rejects.toThrow(/^\[native:changed-since\] /);
    expect(await live()).toEqual([]);
  });

  it("refuses the id of a split child or another account's row", async () => {
    await batchUpdateTransactions({
      added: [
        {
          id: 'p',
          account: 'checking',
          date: '2016-12-20',
          amount: -1000,
          is_parent: true,
        },
        {
          id: NEW_ID,
          account: 'checking',
          date: '2016-12-20',
          amount: -1000,
          is_child: true,
          parent_id: 'p',
        },
        { id: OTHER_ID, account: 'savings', date: '2016-12-20', amount: -1000 },
      ] as never,
    });
    const before = await live();
    await expect(save()).rejects.toThrow(/^\[native:invalid-draft\] /);
    await expect(save({ draft: draft({ newId: OTHER_ID }) })).rejects.toThrow(
      /^\[native:invalid-draft\] /,
    );
    expect(await live()).toEqual(before);
  });
});

describe('native/transaction-save: rules at save', () => {
  it('refuses with preview-stale when a rule changed since the preview, storing nothing', async () => {
    const rule = await costcoRule();
    const preview = await h['native/transaction-preview']({
      draft: draft({ payee: 'costco' }),
      changedField: 'payee',
    });
    expect(preview.draft.category).toBe('groceries');
    await updateRule({
      id: rule,
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'payee', value: 'costco' }],
      actions: [{ op: 'set', field: 'category', value: 'household' }],
    });
    await expect(save({ draft: preview.draft })).rejects.toThrow(
      /^\[native:preview-stale\] /,
    );
    expect(await live()).toEqual([]);
  });

  it('refuses with preview-stale when no preview was answered', async () => {
    await costcoRule();
    await expect(save({ draft: draft({ payee: 'costco' }) })).rejects.toThrow(
      /^\[native:preview-stale\] /,
    );
    expect(await live()).toEqual([]);
  });

  it('saves the previewed draft, and evaluating the amount is not a difference', async () => {
    await costcoRule();
    const preview = await h['native/transaction-preview']({
      draft: draft({ payee: 'costco', amountText: '12.50+3*2' }),
      changedField: 'payee',
    });
    await save({ draft: preview.draft });
    expect(await row(NEW_ID)).toMatchObject({
      category: 'groceries',
      amount: -1850,
    });
  });

  it("keeps the person's own fields", async () => {
    await costcoRule();
    await save({
      draft: draft({
        payee: 'costco',
        category: 'dining',
        userFields: ['category'],
      }),
    });
    expect((await row(NEW_ID))?.category).toBe('dining');
  });

  it("creates the payee a rule names, in the save's undo step", async () => {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'contains', field: 'notes', value: 'zz' }],
      actions: [{ op: 'set', field: 'payee_name', value: 'Brand New Payee' }],
    });
    const before = await count('payees');
    let shown = draft({ notes: 'zz' });
    for (let i = 0; i < 10; i++) {
      shown = (
        await h['native/transaction-preview']({
          draft: shown,
          changedField: 'notes',
        })
      ).draft as never;
    }
    expect(shown).toMatchObject({ payee: null, payeeName: 'Brand New Payee' });
    expect(await count('payees')).toBe(before);
    await save({ draft: shown });
    const created = await db.first<{ id: string }>(
      "SELECT id FROM payees WHERE name = 'Brand New Payee' AND tombstone = 0",
    );
    expect((await row(NEW_ID))?.description).toBe(created?.id);
    await undo();
    expect(await count('payees')).toBe(before);
  });

  it('refuses a rule that sets a closed account', async () => {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'notes', value: 'move' }],
      actions: [{ op: 'set', field: 'account', value: 'old' }],
    });
    await expect(save({ draft: draft({ notes: 'move' }) })).rejects.toThrow(
      /^\[native:preview-stale\] /,
    );
    expect(await live()).toEqual([]);
  });
});

describe('native/transaction-save: validation', () => {
  it("lists only field codes, never the person's text", async () => {
    const notes = 'secret words '.repeat(1000);
    const error = await save({ draft: draft({ notes }) }).catch(e => e);
    expect(error.message).toMatch(/^\[native:invalid-draft:notes-too-long\] /);
    expect(error.message).not.toContain('secret words');
    expect(await live()).toEqual([]);
  });

  it.each([
    [{ account: 'old' }, 'account-closed'],
    [{ payee: 'to-old' }, 'account-closed'],
    [{ payee: 'to-checking' }, 'transfer-same-account'],
    [{ category: 'secret' }, 'category-hidden'],
    [{ date: '2026-02-30' }, 'date-invalid'],
    [{ amountText: '1e20' }, 'amount-invalid'],
    [{ amountText: '-5' }, 'amount-negative'],
    [{ amountText: '3-8' }, 'amount-negative'],
    [{ amountText: '12 34' }, 'amount-invalid'],
    [{ payeeName: 'p'.repeat(201) }, 'payee-too-long'],
    [{ payee: 'to-savings', category: 'groceries' }, 'category-not-allowed'],
    [
      { account: 'boat', payee: 'to-house', category: 'groceries' },
      'category-not-allowed',
    ],
  ])('refuses %j with invalid-draft:%s', async (over, code) => {
    await expect(save({ draft: draft(over) })).rejects.toThrow(
      `[native:invalid-draft:${code}] `,
    );
    expect(await live()).toEqual([]);
  });

  it('saves a category on the on-budget side of a transfer to an off-budget account', async () => {
    await save({ draft: draft({ payee: 'to-house', category: 'groceries' }) });
    const saved = await row(NEW_ID);
    expect(saved?.category).toBe('groceries');
    expect((await row(saved?.transferred_id as string))?.acct).toBe('house');
  });

  it('caps the children by transaction-split-max-children (default 50, ceiling 200)', async () => {
    const children = (n: number) =>
      Array.from({ length: n }, () => ({
        category: null,
        notes: '',
        inflow: false,
        amountText: '1',
      }));
    await expect(
      save({ draft: draft({ amountText: '51', splits: children(51) }) }),
    ).rejects.toThrow('[native:invalid-draft:split-limit] ');
    expect(await live()).toEqual([]);
    await setPref('transaction-split-max-children', '120');
    await save({ draft: draft({ amountText: '100', splits: children(100) }) });
    expect(await live()).toHaveLength(101);
  });

  it('reuses a live payee of the same name ignoring case and creates none', async () => {
    const before = await count('payees');
    await save({ draft: draft({ payeeName: 'costco ' }) });
    expect((await row(NEW_ID))?.description).toBe('costco');
    expect(await count('payees')).toBe(before);
  });

  it('refuses a new payee named like a transfer payee, or blank, creating nothing', async () => {
    const before = await count('payees');
    for (const payeeName of ['Savings', 'savings ', '   ']) {
      await expect(save({ draft: draft({ payeeName }) })).rejects.toThrow(
        /^\[native:invalid-draft\] /,
      );
    }
    expect(await count('payees')).toBe(before);
    expect(await live()).toEqual([]);
  });

  it('honours learn-categories', async () => {
    const rules = () => count('rules');
    // The web learns a payee's category from three of its last five rows
    await setPref('learn-categories', 'false');
    for (const newId of [
      '1b4e28ba-2fa1-41d2-883f-0016d3cca427',
      '2c5f39cb-3fb2-42e3-994f-1127e4ddb538',
      '3d6f4adc-4fc3-43f4-a55f-2238f5eec649',
    ]) {
      await save({
        draft: draft({ newId, payee: 'costco', category: 'dining' }),
      });
    }
    expect(await rules()).toBe(0);
    await setPref('learn-categories', 'true');
    await save({
      draft: draft({ newId: OTHER_ID, payee: 'costco', category: 'dining' }),
    });
    expect(await rules()).toBeGreaterThan(0);
  });
});

describe('native/transaction-save: an edit', () => {
  async function addSplit() {
    await batchUpdateTransactions({
      added: [
        {
          id: 'split',
          account: 'checking',
          date: '2016-12-20',
          payee: 'costco',
          amount: -3000,
          is_parent: true,
        },
        {
          id: 'split/a',
          account: 'checking',
          date: '2016-12-20',
          category: 'groceries',
          amount: -1000,
          is_child: true,
          parent_id: 'split',
        },
        {
          id: 'split/b',
          account: 'checking',
          date: '2016-12-20',
          payee: 'to-savings',
          amount: -2000,
          is_child: true,
          parent_id: 'split',
        },
      ] as never,
    });
  }

  const editDraft = (over: Record<string, unknown> = {}) => {
    const { newId: _n, ...rest } = draft({
      id: 'split',
      payee: 'costco',
      amountText: '30',
      splits: [
        {
          id: 'split/a',
          category: 'groceries',
          notes: '',
          inflow: false,
          amountText: '10',
        },
        {
          id: 'split/b',
          payee: 'to-savings',
          category: null,
          notes: '',
          inflow: false,
          amountText: '20',
        },
      ],
      ...over,
    });
    return rest;
  };

  it('refuses without a digest, or with one that no longer matches', async () => {
    await addSplit();
    await expect(saveDraft(editDraft())).rejects.toThrow(
      /^\[native:changed-since\] /,
    );
    const { transaction } = await form('split');
    await db.update('transactions', { id: 'split/a', notes: 'elsewhere' });
    await expect(
      saveDraft(editDraft({ notes: 'mine' }), { digest: transaction?.digest }),
    ).rejects.toThrow(/^\[native:changed-since\] /);
    expect((await row('split'))?.notes).toBeNull();
  });

  it('refuses when only the transfer partner changed', async () => {
    await addSplit();
    const { transaction } = await form('split');
    const partner = (await row('split/b'))?.transferred_id as string;
    await db.update('transactions', { id: partner, notes: 'other side' });
    await expect(
      saveDraft(editDraft({ notes: 'mine' }), { digest: transaction?.digest }),
    ).rejects.toThrow(/^\[native:changed-since\] /);
  });

  it('saves the parent and children, adding and removing children, as one undo step', async () => {
    await addSplit();
    const { transaction } = await form('split');
    expect(
      await saveDraft(
        editDraft({
          notes: 'Weekly',
          amountText: '35',
          splits: [
            {
              id: 'split/a',
              category: 'dining',
              notes: '',
              inflow: false,
              amountText: '15',
            },
            {
              category: 'groceries',
              notes: 'new',
              inflow: false,
              amountText: '20',
            },
          ],
        }),
        { digest: transaction?.digest },
      ),
    ).toEqual({ id: 'split' });
    expect((await row('split'))?.amount).toBe(-3500);
    expect((await row('split'))?.notes).toBe('Weekly');
    expect((await row('split/a'))?.category).toBe('dining');
    expect((await row('split/b'))?.tombstone).toBe(1);
    expect((await live()).filter(r => r.parent_id === 'split')).toHaveLength(2);
    await undo();
    expect((await row('split'))?.amount).toBe(-3000);
    expect((await row('split/b'))?.tombstone).toBe(0);
  });

  // PR 451 review: a child id can only name one of this transaction's own
  // children; an add's children are all new, with ids the engine creates
  it('refuses an add that names any existing row as a child, changing nothing', async () => {
    await db.insertTransaction({
      id: 'rec',
      account: 'savings',
      date: '2016-12-20',
      amount: -9999,
      cleared: true,
      reconciled: true,
    });
    await addSplit();
    await db.insertTransaction({
      id: 'dead',
      account: 'checking',
      date: '2016-12-20',
      amount: -1,
      tombstone: 1,
    });
    const before = await db.all('SELECT * FROM transactions ORDER BY id');
    const child = (id: string) => ({
      id,
      category: null,
      notes: '',
      inflow: false,
      amountText: '6',
    });
    for (const id of ['rec', 'split/a', 'dead', 'nope']) {
      await expect(
        save({
          draft: draft({ amountText: '12', splits: [child(id), child('x')] }),
          confirmedReconciled: true,
        }),
      ).rejects.toThrow(/^\[native:invalid-draft\] /);
    }
    expect(await db.all('SELECT * FROM transactions ORDER BY id')).toEqual(
      before,
    );
    expect(await row('rec')).toMatchObject({
      acct: 'savings',
      amount: -9999,
      reconciled: 1,
      isChild: 0,
      parent_id: null,
    });
  });

  it('refuses an edit whose child id is not one of its own live children', async () => {
    await addSplit();
    await db.insertTransaction({
      id: 'other',
      account: 'savings',
      date: '2016-12-20',
      amount: -1000,
    });
    await db.insertTransaction({
      id: 'gone',
      account: 'checking',
      date: '2016-12-20',
      amount: -1000,
      is_child: true,
      parent_id: 'split',
      tombstone: 1,
    });
    const { transaction } = await form('split');
    const before = await db.all('SELECT * FROM transactions ORDER BY id');
    const child = (id: string) => ({
      id,
      category: 'groceries',
      notes: '',
      inflow: false,
      amountText: '10',
    });
    for (const ids of [
      ['split/a', 'other'],
      ['split/a', 'gone'],
      ['split/a', 'split'],
      ['split/a', 'split/a'],
    ]) {
      await expect(
        saveDraft(editDraft({ amountText: '20', splits: ids.map(child) }), {
          digest: transaction?.digest,
        }),
      ).rejects.toThrow(/^\[native:invalid-draft\] /);
    }
    expect(await db.all('SELECT * FROM transactions ORDER BY id')).toEqual(
      before,
    );
  });

  it('refuses an edit of a row in a closed account', async () => {
    await db.insertTransaction({
      id: 'shut',
      account: 'old',
      date: '2016-12-20',
      amount: -1000,
    });
    const digest = await transactionDigest('shut');
    const { newId: _n, ...edit } = draft({ id: 'shut', notes: 'x' });
    await expect(saveDraft(edit, { digest })).rejects.toThrow(
      /^\[native:not-found\] /,
    );
    expect((await row('shut'))?.notes).toBeNull();
  });

  it('runs no rules on an edit', async () => {
    await db.insertTransaction({
      id: 'one',
      account: 'checking',
      date: '2016-12-20',
      amount: -1000,
      payee: 'costco',
    });
    await costcoRule();
    const { transaction } = await form('one');
    const { newId: _n, ...edit } = draft({
      id: 'one',
      payee: 'costco',
      notes: 'x',
    });
    await saveDraft(edit, { digest: transaction?.digest });
    expect((await row('one'))?.category).toBeNull();
  });

  it('needs confirmedReconciled for a reconciled row or the child of a reconciled split', async () => {
    await addSplit();
    await db.update('transactions', { id: 'split', reconciled: 1 });
    const { transaction } = await form('split');
    for (const confirmedReconciled of [undefined, false, 'true', 1]) {
      await expect(
        saveDraft(editDraft({ notes: 'x' }), {
          digest: transaction?.digest,
          confirmedReconciled,
        }),
      ).rejects.toThrow(/^\[native:needs-confirmed-reconciled\] /);
    }
    // The transfer partner of a child: its own flag unset, its split parent reconciled
    const partner = (await row('split/b'))?.transferred_id as string;
    const partnerForm = await form(partner);
    const { newId: _n, ...edit } = draft({
      id: partner,
      account: 'savings',
      payee: 'to-checking',
      amountText: '20',
      inflow: true,
      notes: 'y',
    });
    await expect(
      saveDraft(edit, { digest: partnerForm.transaction?.digest }),
    ).rejects.toThrow(/^\[native:needs-confirmed-reconciled\] /);
    await saveDraft(editDraft({ notes: 'x' }), {
      digest: transaction?.digest,
      confirmedReconciled: true,
    });
    expect((await row('split'))?.notes).toBe('x');
  });
});

describe('native/undo after a save', () => {
  it('refuses with undo-changed-since after a later change to a saved row', async () => {
    await save();
    // As a sync would apply it
    await db.update('transactions', { id: NEW_ID, amount: -5000 });
    await expect(undo()).rejects.toThrow(/^\[native:undo-changed-since\] /);
    expect((await row(NEW_ID))?.tombstone).toBe(0);
  });
});
