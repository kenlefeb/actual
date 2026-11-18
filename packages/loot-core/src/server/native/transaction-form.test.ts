// Fork-only (sc-3602, openspec/changes/native-add-transaction D1 and D2).
// The contract for the native Add transaction sheet's reads: the form, the
// payee search and the preview. The Swift package decodes the fixtures this
// file writes. Regenerate with `vitest -u`.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';
import { createSchedule, app as schedulesApp } from '#server/schedules/app';
import { batchUpdateTransactions } from '#server/transactions';
import {
  insertRule,
  loadRules,
  runRules,
} from '#server/transactions/transaction-rules';
import * as monthUtils from '#shared/months';

import { app } from './app';
import { NATIVE_REFUSAL_CODES } from './refusal';
import { FIELD_ERROR_CODES } from './transaction-form';

const h = app.handlers;
const form = (args: Record<string, unknown> = {}) =>
  h['native/transaction-form'](args as never);
const payees = (search: unknown) => h['native/payees']({ search } as never);
const preview = (
  draft: Record<string, unknown>,
  changedField: string | null = null,
) => h['native/transaction-preview']({ draft, changedField } as never);
const setPref = (id: string, value: string) =>
  db.update('preferences', { id, value });

const NEW_ID = '0b5f2c1e-8d3a-4f6b-9c2d-1a2b3c4d5e6f';
// A draft the sheet sends for a new transaction, before any rule
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

async function addAccount(id: string, name: string, over = {}) {
  await db.insertAccount({ id, name, ...over });
  await db.insertPayee({ id: `to-${id}`, name, transfer_acct: id });
}

const transactionCount = async () =>
  (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM transactions'))?.n;
const payeeCount = async () =>
  (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM payees'))?.n;

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  await loadMappings();
  await loadRules();
  schedulesApp.startServices();
  await addAccount('checking', 'Checking');
  await addAccount('savings', 'Savings');
  await addAccount('house', 'House', { offbudget: 1 });
  await addAccount('old', 'Old', { closed: 1 });
  await addAccount('gone', 'Gone', { tombstone: 1 });
  await db.insertCategoryGroup({ id: 'food-group', name: 'Food' });
  await db.insertCategory({
    id: 'groceries',
    name: 'Groceries',
    cat_group: 'food-group',
  });
  await db.insertCategory({
    id: 'dining',
    name: 'Dining',
    cat_group: 'food-group',
  });
  await db.insertCategory({
    id: 'secret',
    name: 'Secret',
    cat_group: 'food-group',
    hidden: 1,
  });
  await db.insertCategoryGroup({
    id: 'hidden-group',
    name: 'Hidden',
    hidden: 1,
  });
  await db.insertCategory({
    id: 'stash',
    name: 'Stash',
    cat_group: 'hidden-group',
  });
  await db.insertPayee({ id: 'costco', name: 'Costco' });
  await db.insertPayee({ id: 'corner', name: 'Corner Store', favorite: 1 });
  await db.insertPayee({ id: 'costco-old', name: 'Costco Old', tombstone: 1 });
  await db.insertPayee({ id: 'sale', name: '50% Off' });
  await db.insertPayee({ id: 'under', name: 'a_b' });
  await db.insertPayee({ id: 'slash', name: 'back\\slash' });
  await db.insertPayee({ id: 'plain', name: 'aXb 5000 Off' });
});

// A split in Checking: a Groceries child and a child transferring to Savings
async function addSplit() {
  await batchUpdateTransactions({
    added: [
      {
        id: 'split',
        account: 'checking',
        date: '2016-12-20',
        payee: 'costco',
        amount: -3000,
        notes: 'Weekly shop',
        is_parent: true,
      },
      {
        id: 'split/a',
        account: 'checking',
        date: '2016-12-20',
        payee: 'costco',
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
  const partner = await db.first<{ transferred_id: string }>(
    "SELECT transferred_id FROM transactions WHERE id = 'split/b'",
  );
  return partner?.transferred_id as string;
}

describe('native/transaction-form', () => {
  it("returns the accounts, the categories marked hidden or not and an add form's defaults, matching the fixture", async () => {
    const result = await form({ account_id: 'savings' });
    expect(result.accounts).toEqual([
      {
        id: 'checking',
        name: 'Checking',
        offbudget: false,
        transferPayee: 'to-checking',
      },
      {
        id: 'savings',
        name: 'Savings',
        offbudget: false,
        transferPayee: 'to-savings',
      },
      {
        id: 'house',
        name: 'House',
        offbudget: true,
        transferPayee: 'to-house',
      },
    ]);
    // Hidden ones too, marked, so an edit can keep one (PR 444); a hidden
    // group's categories count as hidden
    expect(result.categoryGroups).toEqual([
      expect.objectContaining({
        id: 'food-group',
        // In sort_order, as the web picker lists them
        categories: [
          { id: 'secret', name: 'Secret', hidden: true },
          { id: 'dining', name: 'Dining', hidden: false },
          { id: 'groceries', name: 'Groceries', hidden: false },
        ],
      }),
      expect.objectContaining({
        id: 'hidden-group',
        categories: [{ id: 'stash', name: 'Stash', hidden: true }],
      }),
    ]);
    expect(result.defaults).toEqual({
      account: 'savings',
      date: monthUtils.currentDay(),
      cleared: false,
    });
    expect(result.transaction).toBeNull();
    expect(result.currencyCode).toBeDefined();
    await expect(
      JSON.stringify(
        { ...result, defaults: { ...result.defaults, date: '2016-12-20' } },
        null,
        2,
      ) + '\n',
    ).toMatchFileSnapshot('./fixtures/transaction-form-add.json');
  });

  it('presets no account for a closed or unknown one', async () => {
    expect((await form({ account_id: 'old' })).defaults?.account).toBeNull();
    expect((await form({ account_id: 'nope' })).defaults?.account).toBeNull();
    expect((await form({})).defaults?.account).toBeNull();
  });

  it('reads a split transfer with names resolved and a digest, matching the fixture', async () => {
    const partner = await addSplit();
    const result = await form({ id: 'split' });
    expect(result.defaults).toBeNull();
    const t = result.transaction;
    expect(t).toMatchObject({
      id: 'split',
      account: 'checking',
      date: '2016-12-20',
      payee: 'costco',
      payeeName: 'Costco',
      category: null,
      notes: 'Weekly shop',
      amount: -3000,
      reconciled: false,
      transferAccount: null,
      partner: null,
      schedule: null,
      attachments: [],
    });
    expect(t?.splits).toEqual([
      expect.objectContaining({
        id: 'split/a',
        category: 'groceries',
        categoryName: 'Groceries',
        amount: -1000,
        transferAccount: null,
        partner: null,
      }),
      expect.objectContaining({
        id: 'split/b',
        payee: 'to-savings',
        payeeName: 'Savings',
        amount: -2000,
        transferAccount: { id: 'savings', name: 'Savings' },
        transferAccountClosed: false,
        // The other side's own fields, for Reload (D1)
        partner: {
          id: expect.any(String),
          account: 'savings',
          date: '2016-12-20',
          amount: 2000,
          notes: '',
          cleared: false,
          reconciled: false,
        },
      }),
    ]);
    expect(t?.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(t?.splits[1].partner?.id).toBe(partner);
    await expect(
      JSON.stringify(
        { ...result, transaction: { ...t, digest: '<sha-256>' } },
        null,
        2,
      ) + '\n',
    ).toMatchFileSnapshot('./fixtures/transaction-form.json');
  });

  it('reads the reconciled flag, the schedule and the attachment names', async () => {
    const schedule = await createSchedule({
      schedule: { name: 'Rent' },
      conditions: [{ op: 'is', field: 'date', value: '2016-12-20' }],
    });
    await db.insertTransaction({
      id: 'rec',
      account: 'checking',
      date: '2016-12-20',
      amount: -500,
      cleared: true,
      reconciled: true,
      schedule,
    });
    await db.insertWithSchema('transaction_attachments', {
      id: 'att',
      transaction_id: 'rec',
      name: 'receipt.pdf',
      mime: 'application/pdf',
      size: 1,
      sha256: 'x',
      created_at: '2016-12-20',
    });
    const t = (await form({ id: 'rec' })).transaction;
    expect(t).toMatchObject({
      reconciled: true,
      cleared: true,
      schedule: { id: schedule, name: 'Rent' },
      attachments: ['receipt.pdf'],
    });
  });

  it("fails with not-found for a deleted id, a split child, an unknown id or a closed account's row", async () => {
    await addSplit();
    await db.insertTransaction({
      id: 'dead',
      account: 'checking',
      date: '2016-12-20',
      amount: -1,
      tombstone: 1,
    });
    await db.insertTransaction({
      id: 'closed-row',
      account: 'old',
      date: '2016-12-20',
      amount: -1,
    });
    for (const id of ['dead', 'split/a', 'nope', 'closed-row', 7]) {
      await expect(form({ id })).rejects.toThrow(/^\[native:not-found\] /);
    }
  });

  it('changes the digest when a child is added, a transfer is relinked or a partner changes', async () => {
    const partner = await addSplit();
    const digest = async () =>
      (await form({ id: 'split' })).transaction?.digest;
    const first = await digest();
    expect(await digest()).toBe(first);

    // Task 1.0: the shared state reader now carries the order too
    await db.update('transactions', { id: 'split/a', sort_order: 99 });
    const afterOrder = await digest();
    expect(afterOrder).not.toBe(first);

    await db.update('transactions', { id: partner, notes: 'changed' });
    const afterPartner = await digest();
    expect(afterPartner).not.toBe(afterOrder);

    await db.update('transactions', { id: 'split/b', transferred_id: null });
    const afterRelink = await digest();
    expect(afterRelink).not.toBe(afterPartner);

    await db.insertTransaction({
      id: 'split/c',
      account: 'checking',
      date: '2016-12-20',
      amount: 0,
      is_child: true,
      parent_id: 'split',
    });
    expect(await digest()).not.toBe(afterRelink);
  });
});

describe('native/payees', () => {
  it('returns live, non-transfer payees, favourites first then by name, as id, name and favourite only, matching the fixture', async () => {
    const result = await payees('');
    expect(result.payees.map(p => p.name)).toEqual([
      'Corner Store',
      '50% Off',
      'a_b',
      'aXb 5000 Off',
      'back\\slash',
      'Costco',
    ]);
    expect(Object.keys(result.payees[0]).sort()).toEqual([
      'favorite',
      'id',
      'name',
    ]);
    expect(result.payees[0].favorite).toBe(true);
    await expect(JSON.stringify(result, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/payees.json',
    );
  });

  it('matches case-insensitively and never returns a deleted payee', async () => {
    expect((await payees('costco')).payees.map(p => p.id)).toEqual(['costco']);
  });

  it('matches %, _ and \\ literally', async () => {
    expect((await payees('%')).payees.map(p => p.id)).toEqual(['sale']);
    expect((await payees('_')).payees.map(p => p.id)).toEqual(['under']);
    expect((await payees('\\')).payees.map(p => p.id)).toEqual(['slash']);
  });

  it('refuses search text over payee-search-max-length (default 100, ceiling 200)', async () => {
    await payees('a'.repeat(100));
    await expect(payees('a'.repeat(101))).rejects.toThrow(/search/);
    await setPref('payee-search-max-length', '150');
    await payees('a'.repeat(150));
    await expect(payees('a'.repeat(151))).rejects.toThrow(/search/);
    await setPref('payee-search-max-length', '900');
    await expect(payees('a'.repeat(101))).rejects.toThrow(/search/);
    await expect(payees(5)).rejects.toThrow(/search/);
  });

  it('caps the results by payee-picker-max-results (default 50, ceiling 500); bad values use the default', async () => {
    for (let i = 0; i < 130; i++) {
      await db.insertPayee({ id: `p${i}`, name: `Shop ${i}` });
    }
    expect((await payees('shop')).payees).toHaveLength(50);
    await setPref('payee-picker-max-results', '120');
    expect((await payees('shop')).payees).toHaveLength(120);
    for (const bad of ['0', '900', '1e2', 'abc']) {
      await setPref('payee-picker-max-results', bad);
      expect((await payees('shop')).payees).toHaveLength(50);
    }
  });
});

describe('native/transaction-preview', () => {
  async function costcoRule() {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'payee', value: 'costco' }],
      actions: [
        { op: 'set', field: 'category', value: 'groceries' },
        { op: 'set', field: 'notes', value: 'Bulk' },
      ],
    });
  }

  it("evaluates arithmetic in the budget's number format as signed minor units", async () => {
    expect((await preview(draft({ amountText: '12.50+3*2' }))).amount).toBe(
      -1850,
    );
    expect(
      (await preview(draft({ amountText: '12.50+3*2', inflow: true }))).amount,
    ).toBe(1850);
    await setPref('numberFormat', 'dot-comma');
    expect((await preview(draft({ amountText: '1.000,33' }))).amount).toBe(
      -100033,
    );
    expect((await preview(draft({ amountText: '12,5+1' }))).amount).toBe(-1350);
    for (const [format, text] of [
      ['space-comma', '1\u202F000,33'],
      ['apostrophe-dot', '1\u2019000.33'],
      ['comma-dot-in', '1,000.33'],
    ]) {
      await setPref('numberFormat', format);
      expect((await preview(draft({ amountText: text }))).amount).toBe(-100033);
    }
    await setPref('numberFormat', 'comma-dot');
    expect((await preview(draft({ amountText: '1,000.33' }))).amount).toBe(
      -100033,
    );
  });

  it('reports amount-invalid and amount-required', async () => {
    for (const amountText of [
      '1'.repeat(101),
      '100000000000000000000',
      '99999999999999999',
      '1/0',
      '1.005',
      'abc',
    ]) {
      expect((await preview(draft({ amountText }))).errors).toMatchObject({
        amount: 'amount-invalid',
      });
    }
    expect((await preview(draft({ amountText: '' }))).errors).toMatchObject({
      amount: 'amount-required',
    });
  });

  it('runs the rules on a new draft, as rules-run does, and writes nothing', async () => {
    await costcoRule();
    const before = await transactionCount();
    const result = await preview(draft({ payee: 'costco' }), 'payee');
    const ruled = await runRules({
      id: 'temp',
      account: 'checking',
      date: '2016-12-20',
      payee: 'costco',
      category: null,
      notes: '',
      cleared: false,
      amount: -1000,
    });
    expect(result.draft.category).toBe(ruled.category);
    expect(result.draft.notes).toBe(ruled.notes);
    expect(result.ruleFields.sort()).toEqual(['category', 'notes']);
    expect(result.replaced).toEqual([]);
    expect(result.errors).toEqual({});
    expect(await transactionCount()).toBe(before);
    await expect(JSON.stringify(result, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/transaction-preview.json',
    );
  });

  it("keeps listing a rule's field on a later preview", async () => {
    await costcoRule();
    const first = await preview(draft({ payee: 'costco' }), 'payee');
    const second = await preview(
      { ...first.draft, amountText: '20' },
      'amount',
    );
    expect(second.draft.category).toBe('groceries');
    expect(second.ruleFields).toContain('category');
  });

  it('runs no rules on a draft with an id', async () => {
    await costcoRule();
    const { newId: _n, ...rest } = draft({ payee: 'costco' });
    const result = await preview({ ...rest, id: 'existing' }, 'payee');
    expect(result.draft.category).toBeNull();
    expect(result.ruleFields).toEqual([]);
  });

  it('on another change fills only empty fields', async () => {
    await costcoRule();
    const result = await preview(
      draft({ payee: 'costco', category: 'dining', notes: 'Mine' }),
      'amount',
    );
    expect(result.draft.category).toBe('dining');
    expect(result.draft.notes).toBe('Mine');
  });

  it('keeps a field the person cleared empty, even on a payee change', async () => {
    await costcoRule();
    const result = await preview(
      draft({ payee: 'costco', userFields: ['category'] }),
      'payee',
    );
    expect(result.draft.category).toBeNull();
    expect(result.draft.notes).toBe('Bulk');
    const later = await preview(
      draft({ payee: 'costco', userFields: ['category'] }),
      'amount',
    );
    expect(later.draft.category).toBeNull();
  });

  it('lets a payee change replace a field the person set, and lists its previous value', async () => {
    await costcoRule();
    const result = await preview(
      draft({ payee: 'costco', category: 'dining', userFields: ['category'] }),
      'payee',
    );
    expect(result.draft.category).toBe('groceries');
    expect(result.replaced).toEqual([{ field: 'category', value: 'dining' }]);
    expect(result.ruleFields).toContain('category');
    const other = await preview(
      draft({ payee: 'costco', category: 'dining', userFields: ['category'] }),
      'amount',
    );
    expect(other.draft.category).toBe('dining');
    expect(other.ruleFields).not.toContain('category');
    await expect(JSON.stringify(result, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/transaction-preview-replaced.json',
    );
  });

  it('applies a split rule, and returns the children and the remainder', async () => {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'payee', value: 'costco' }],
      actions: [
        {
          op: 'set-split-amount',
          value: 400,
          options: { splitIndex: 1, method: 'fixed-amount' },
        },
        {
          op: 'set',
          field: 'category',
          value: 'groceries',
          options: { splitIndex: 1 },
        },
        {
          op: 'set-split-amount',
          value: null,
          options: { splitIndex: 2, method: 'remainder' },
        },
      ],
    });
    const result = await preview(draft({ payee: 'costco' }), 'payee');
    const ruled = await runRules({
      id: 'temp',
      account: 'checking',
      date: '2016-12-20',
      payee: 'costco',
      category: null,
      notes: '',
      cleared: false,
      amount: -1000,
    });
    expect(result.splitAmounts).toEqual(
      ruled.subtransactions?.map(s => s.amount),
    );
    expect(result.splitAmounts).toHaveLength(2);
    expect(result.draft.splits[0].category).toBe('groceries');
    expect(result.remaining).toBe(0);
    expect(result.ruleFields).toContain('splits');
  });

  it('reports the remainder and split-mismatch on a grouped split', async () => {
    const result = await preview(
      draft({
        amountText: '30',
        splits: [
          { category: 'groceries', notes: '', inflow: false, amountText: '10' },
          { category: 'dining', notes: '', inflow: false, amountText: '5' },
        ],
      }),
      'splits',
    );
    expect(result.splitAmounts).toEqual([-1000, -500]);
    expect(result.remaining).toBe(-1500);
    expect(result.errors).toMatchObject({ splits: 'split-mismatch' });
    await expect(JSON.stringify(result, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/transaction-preview-split.json',
    );
  });

  it('reports split-limit over transaction-split-max-children (default 50, ceiling 200)', async () => {
    const children = (n: number) =>
      Array.from({ length: n }, () => ({
        category: null,
        notes: '',
        inflow: false,
        amountText: '1',
      }));
    expect(
      (await preview(draft({ amountText: '51', splits: children(51) }))).errors,
    ).toMatchObject({ splits: 'split-limit' });
    expect(
      (await preview(draft({ amountText: '50', splits: children(50) }))).errors,
    ).toEqual({});
    await setPref('transaction-split-max-children', '120');
    expect(
      (await preview(draft({ amountText: '100', splits: children(100) })))
        .errors,
    ).toEqual({});
    await setPref('transaction-split-max-children', 'abc');
    expect(
      (await preview(draft({ amountText: '51', splits: children(51) }))).errors,
    ).toMatchObject({ splits: 'split-limit' });
  });

  it('reports date-invalid outside 1900 to 2999 and allows a future date', async () => {
    for (const date of ['2026-02-30', '1899-12-31', '3000-01-01', '2016-1-2']) {
      expect((await preview(draft({ date }))).errors).toMatchObject({
        date: 'date-invalid',
      });
    }
    expect((await preview(draft({ date: '2999-12-31' }))).errors).toEqual({});
    expect((await preview(draft({ date: '2027-01-15' }))).errors).toEqual({});
  });

  it('reports notes-too-long on any row over transaction-notes-max-length', async () => {
    const long = 'n'.repeat(10_001);
    expect((await preview(draft({ notes: long }))).errors).toMatchObject({
      notes: 'notes-too-long',
    });
    const result = await preview(
      draft({
        amountText: '2',
        splits: [
          { category: null, notes: '', inflow: false, amountText: '1' },
          { category: null, notes: long, inflow: false, amountText: '1' },
        ],
      }),
    );
    expect(result.errors).toEqual({ 'splits.1.notes': 'notes-too-long' });
    await setPref('transaction-notes-max-length', '20000');
    expect((await preview(draft({ notes: long }))).errors).toEqual({});
  });

  it('reports the account and category codes', async () => {
    expect((await preview(draft({ account: '' }))).errors).toMatchObject({
      account: 'account-required',
    });
    for (const account of ['old', 'gone', 'nope']) {
      expect((await preview(draft({ account }))).errors).toMatchObject({
        account: 'account-closed',
      });
    }
    expect(
      (await preview(draft({ account: 'house', category: 'groceries' })))
        .errors,
    ).toMatchObject({ category: 'category-not-allowed' });
    expect(
      (await preview(draft({ payee: 'to-savings', category: 'groceries' })))
        .errors,
    ).toMatchObject({ category: 'category-not-allowed' });
    expect(
      (await preview(draft({ payee: 'to-house', category: 'groceries' })))
        .errors,
    ).toEqual({});
    expect((await preview(draft({ category: 'nope' }))).errors).toMatchObject({
      category: 'category-unknown',
    });
  });

  it("reports transfer-same-account for the account's own transfer payee, on the parent and a child", async () => {
    expect((await preview(draft({ payee: 'to-checking' }))).errors).toEqual({
      payee: 'transfer-same-account',
    });
    const result = await preview(
      draft({
        amountText: '2',
        splits: [
          { category: null, notes: '', inflow: false, amountText: '1' },
          {
            payee: 'to-checking',
            category: null,
            notes: '',
            inflow: false,
            amountText: '1',
          },
        ],
      }),
    );
    expect(result.errors).toEqual({
      'splits.1.payee': 'transfer-same-account',
    });
  });

  it('reports category-hidden on a new row, and lets an edited row keep the hidden category it has', async () => {
    expect((await preview(draft({ category: 'secret' }))).errors).toEqual({
      category: 'category-hidden',
    });
    expect((await preview(draft({ category: 'stash' }))).errors).toEqual({
      category: 'category-hidden',
    });
    await db.insertTransaction({
      id: 'kept',
      account: 'checking',
      date: '2016-12-20',
      amount: -1000,
      category: 'secret',
    });
    const { newId: _n, ...edit } = draft({ category: 'secret' });
    expect((await preview({ ...edit, id: 'kept' })).errors).toEqual({});
    await db.update('transactions', { id: 'kept', category: 'dining' });
    expect((await preview({ ...edit, id: 'kept' })).errors).toEqual({
      category: 'category-hidden',
    });
    // A split child: a new child may not take it, a stored one keeps it
    await addSplit();
    await db.update('categories', { id: 'groceries', hidden: 1 });
    const { newId: _m, ...base } = draft();
    const child = (id: string | undefined) => ({
      ...(id && { id }),
      category: 'groceries',
      notes: '',
      inflow: false,
      amountText: '10',
    });
    const splitEdit = {
      ...base,
      id: 'split',
      payee: 'costco',
      amountText: '20',
      splits: [child('split/a'), child(undefined)],
    };
    expect((await preview(splitEdit)).errors).toEqual({
      'splits.1.category': 'category-hidden',
    });
  });

  it('allows a category on the on-budget side of a transfer to an off-budget account only', async () => {
    expect(
      (await preview(draft({ payee: 'to-house', category: 'groceries' })))
        .errors,
    ).toEqual({});
    await db.insertAccount({ id: 'boat', name: 'Boat', offbudget: 1 });
    expect(
      (
        await preview(
          draft({
            account: 'house',
            payee: 'to-checking',
            category: 'groceries',
          }),
        )
      ).errors,
    ).toEqual({ category: 'category-not-allowed' });
    expect(
      (
        await preview(
          draft({ account: 'boat', payee: 'to-house', category: 'groceries' }),
        )
      ).errors,
    ).toEqual({ category: 'category-not-allowed' });
  });

  it('reports account-closed for a transfer to a closed or deleted account', async () => {
    for (const payee of ['to-old', 'to-gone']) {
      expect((await preview(draft({ payee }))).errors).toMatchObject({
        payee: 'account-closed',
      });
    }
  });

  it('reports payee-too-long over payee-name-max-length and never creates a payee', async () => {
    const before = await payeeCount();
    expect(
      (await preview(draft({ payeeName: 'p'.repeat(201) }))).errors,
    ).toMatchObject({ payee: 'payee-too-long' });
    expect(
      (await preview(draft({ payeeName: 'Corner Bakery' }), 'payee')).errors,
    ).toEqual({});
    expect(await payeeCount()).toBe(before);
  });

  it('resolves a new payee name to the live payee of the same name, ignoring case', async () => {
    const result = await preview(draft({ payeeName: ' costco ' }), 'payee');
    expect(result.draft.payee).toBe('costco');
    expect(result.draft.payeeName).toBeNull();
  });

  it.each([
    [{ reconciled: true }],
    [{ imported_id: 'x' }],
    [{ tombstone: 1 }],
    [{ cleared: 'yes' }],
    [{ inflow: 1 }],
    [{ amountText: 5 }],
    [{ date: 20161220 }],
    [{ notes: null }],
    [{ userFields: ['reconciled'] }],
    [{ userFields: 'category' }],
    [{ splits: [{ amountText: '1', reconciled: true }] }],
    [{ splits: [{ category: 5, notes: '', inflow: false, amountText: '1' }] }],
    [{ splits: 'x' }],
    [{ newId: 'ABC' }],
    [{ newId: NEW_ID.toUpperCase() }],
    [{ newId: '../x' }],
    [{ newId: 'a'.repeat(500) }],
    [{ id: 'both' }],
  ])('refuses the draft %j with invalid-draft', async over => {
    await expect(preview(draft(over))).rejects.toThrow(
      /^\[native:invalid-draft\] /,
    );
  });

  it('refuses an unknown changed field and a draft that is not an object', async () => {
    await expect(preview(draft(), 'reconciled')).rejects.toThrow(
      /^\[native:invalid-draft\] /,
    );
    await expect(
      h['native/transaction-preview']({ draft: null } as never),
    ).rejects.toThrow(/^\[native:invalid-draft\] /);
  });
});

describe('field error codes', () => {
  const fixture = (name: string): string[] =>
    JSON.parse(readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

  it('are the field errors fixture', () => {
    expect([...FIELD_ERROR_CODES]).toEqual(
      fixture('transaction-field-errors.json'),
    );
  });

  it('share no code with the refusal codes', () => {
    const refusals = new Set<string>(fixture('native-refusal-codes.json'));
    expect(FIELD_ERROR_CODES.filter(c => refusals.has(c))).toEqual([]);
    expect(NATIVE_REFUSAL_CODES).toContain('not-found');
  });
});
