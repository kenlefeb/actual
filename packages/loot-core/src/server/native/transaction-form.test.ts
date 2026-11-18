// Fork-only (sc-3602, openspec/changes/native-add-transaction D1 and D2).
// The contract for the native Add transaction sheet's reads: the form, the
// payee search and the preview. The Swift package decodes the fixtures this
// file writes. Regenerate with `vitest -u`.
import { createHash } from 'node:crypto';
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
const previewRaw = (draft: Record<string, unknown>) =>
  h['native/transaction-preview']({ draft } as never);
// The errors as bare codes, for the behaviour tests; `raw` is the contract shape
const preview = async (draft: Record<string, unknown>, _changed?: string) => {
  const raw = await previewRaw(draft);
  const errors: Record<string, string> = Object.fromEntries(
    Object.entries(raw.errors).map(([field, error]) => [field, error.code]),
  );
  // Shorthands for the result's amounts
  return {
    ...raw,
    errors,
    raw,
    draft: raw.result,
    amount: raw.result.amount,
    splitAmounts: raw.result.splits.map(s => s.amount),
  };
};
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
  });

  it('reports amount-invalid and amount-required', async () => {
    for (const amountText of [
      '1'.repeat(101),
      '100000000000000000000',
      '99999999999999999',
      '1/0',
      '1.005',
      'abc',
      // The grammar (PR 450): fully consumed, no unary sign
      '1e20',
      '0x10',
      '1_000',
      '12 34',
      '1..5',
      '12abc',
      '2^3',
      '5+',
      '+5',
      '2*-3',
      '(1+2',
      '1$2',
      '$$12',
    ]) {
      expect(
        (await preview(draft({ amountText }))).errors,
        amountText,
      ).toMatchObject({ amount: 'amount-invalid' });
    }
    expect((await preview(draft({ amountText: '' }))).errors).toMatchObject({
      amount: 'amount-required',
    });
  });

  it('takes the sign from the control: a leading minus or a negative result is amount-negative', async () => {
    for (const amountText of ['-5', '−5', '3-8', '3−8']) {
      const result = await preview(draft({ amountText }));
      expect(result.errors, amountText).toEqual({ amount: 'amount-negative' });
      expect(result.draft.inflow).toBe(false);
      expect(result.amount).toBeNull();
    }
    expect(
      (await preview(draft({ amountText: '8−3', inflow: true }))).amount,
    ).toBe(500);
    expect((await preview(draft({ amountText: '8-8' }))).amount).toBe(0);
  });

  it("gives amount-invalid the budget's decimal separator, never the typed text", async () => {
    expect((await previewRaw(draft({ amountText: '1,5' }))).errors).toEqual({
      amount: { code: 'amount-invalid', detail: { decimalSeparator: '.' } },
    });
    await setPref('numberFormat', 'dot-comma');
    expect((await previewRaw(draft({ amountText: '1.5' }))).errors).toEqual({
      amount: { code: 'amount-invalid', detail: { decimalSeparator: ',' } },
    });
    expect(
      (
        await previewRaw(
          draft({ amountText: '3-8', notes: 'n'.repeat(10_001) }),
        )
      ).errors,
    ).toEqual({
      amount: { code: 'amount-negative' },
      notes: { code: 'notes-too-long' },
    });
  });

  it('reads the operators, parentheses, spacing and one currency symbol', async () => {
    expect(
      (await preview(draft({ amountText: '(1,200.50 + 99.50) / 2' }))).amount,
    ).toBe(-65000);
    expect((await preview(draft({ amountText: ' 2 × 3 ÷ 4 ' }))).amount).toBe(
      -150,
    );
    expect((await preview(draft({ amountText: '10-2*3' }))).amount).toBe(-400);
    expect((await preview(draft({ amountText: ' 12.50 ' }))).amount).toBe(
      -1250,
    );
    expect((await preview(draft({ amountText: '.5' }))).amount).toBe(-50);
    expect((await preview(draft({ amountText: '$12.50' }))).amount).toBe(-1250);
    expect((await preview(draft({ amountText: '12.50 €' }))).amount).toBe(
      -1250,
    );
    await setPref('numberFormat', 'space-comma');
    expect(
      (await preview(draft({ amountText: '  (1 000 × 2) − 500 ÷ 2  ' })))
        .amount,
    ).toBe(-175000);
  });

  // The spec's accept and refuse scenarios, per number format (PR 450)
  it.each([
    // A trailing decimal separator reads as no fraction, as the web does; a
    // trailing grouping separator stays refused (PR 453)
    [
      'comma-dot',
      [
        ['1,234.56', 123456],
        ['12.', 1200],
      ],
      ['12,34', '1.234,56', '12 34', '12,'],
    ],
    [
      'dot-comma',
      [
        ['1.234,56', 123456],
        ['12,', 1200],
      ],
      ['1,234.56', '12 34', '12.'],
    ],
    [
      'space-comma',
      [
        ['1 234,56', 123456],
        ['1 234,56', 123456],
        ['1 234,56', 123456],
        ['12,', 1200],
      ],
      ['12 34'],
    ],
    [
      'apostrophe-dot',
      [
        ["1'234.56", 123456],
        ["1'234.56", 123456],
        ['12.', 1200],
      ],
      ["12'34", '12 34', "12'"],
    ],
    [
      'comma-dot-in',
      [
        ['1,00,000.50', 10000050],
        ['1,000', 100000],
        ['12.', 1200],
      ],
      ['1,000,00', '1,000,000', '12 34', '12,'],
    ],
  ] as [string, [string, number][], string[]][])(
    'reads numbers by the %s format',
    async (format, accepted, refused) => {
      await setPref('numberFormat', format);
      for (const [amountText, minor] of accepted) {
        expect(
          (await preview(draft({ amountText, inflow: true }))).amount,
          amountText,
        ).toBe(minor);
      }
      for (const amountText of refused) {
        expect(
          (await preview(draft({ amountText }))).errors,
          amountText,
        ).toEqual({ amount: 'amount-invalid' });
      }
    },
  );

  it('runs the rules once on the input, as rules-run does, and writes nothing', async () => {
    await costcoRule();
    const before = await transactionCount();
    const result = await preview(draft({ payee: 'costco' }));
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
    expect(result.result.category).toBe(ruled.category);
    expect(result.result.notes).toBe(ruled.notes);
    expect(result.result.amountText).toBe('10.00');
    expect(result.ruleFields).toEqual(['category', 'notes']);
    expect(result.suggestions).toEqual([]);
    expect(result.errors).toEqual({});
    expect(await transactionCount()).toBe(before);
    await expect(
      JSON.stringify(result.raw, null, 2) + '\n',
    ).toMatchFileSnapshot('./fixtures/transaction-preview.json');
  });

  it('gives the same input the same result and digest every time', async () => {
    await costcoRule();
    const first = await preview(draft({ payee: 'costco' }));
    const second = await preview(draft({ payee: 'costco' }));
    expect(second.result).toEqual(first.result);
    expect(second.ruleFields).toEqual(['category', 'notes']);
    expect(second.resultDigest).toBe(first.resultDigest);
    expect(
      (await preview(draft({ payee: 'costco', amountText: '11' })))
        .resultDigest,
    ).not.toBe(first.resultDigest);
  });

  it('hashes the rows a save would store, by the canonical form of D2', async () => {
    await costcoRule();
    const result = await preview(
      draft({
        payee: 'costco',
        amountText: '30',
        splits: [
          { category: 'dining', notes: '', inflow: false, amountText: '10' },
          {
            payee: 'to-savings',
            category: null,
            notes: 'x',
            inflow: false,
            amountText: '20',
          },
        ],
      }),
    );
    const row = (over: Record<string, unknown>) => ({
      account: 'checking',
      amount: -3000,
      category: null,
      cleared: false,
      date: '2016-12-20',
      notes: 'Bulk',
      payee: { id: 'costco' },
      schedule: null,
      ...over,
    });
    const rows = [
      // The rule sets the parent's category too; the save would refuse it
      row({ category: 'groceries' }),
      row({ amount: -1000, category: 'dining', notes: null }),
      row({ amount: -2000, notes: 'x', payee: { id: 'to-savings' } }),
    ];
    const expected = createHash('sha256')
      .update(JSON.stringify(rows))
      .digest('hex');
    expect(result.errors).toMatchObject({ category: 'category-not-allowed' });
    expect(result.resultDigest).toBe(expected);
  });

  // PR 447 review, finding 1: a rule that sets a payee by name must not
  // create it from a read; the preview names it and the save creates it
  it('never creates the payee a rule names, nor writes any other table', async () => {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'contains', field: 'notes', value: 'zz' }],
      actions: [{ op: 'set', field: 'payee_name', value: 'Brand New Payee' }],
    });
    await costcoRule();
    const tables = [
      'payees',
      'payee_mapping',
      'categories',
      'schedules',
      'rules',
      'transactions',
      'messages_crdt',
    ];
    const counts = async () =>
      Promise.all(
        tables.map(
          async t =>
            (await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))
              ?.n,
        ),
      );
    const before = await counts();
    for (let i = 0; i < 10; i++) {
      const result = await preview(draft({ notes: 'zz' }));
      expect(result.result.payee).toBeNull();
      expect(result.result.payeeName).toBe('Brand New Payee');
      expect(result.ruleFields).toContain('payee');
    }
    await preview(
      draft({ notes: 'zz', payee: 'costco', userFields: ['payee'] }),
    );
    expect(await counts()).toEqual(before);
  });

  it('runs no rules on a draft with an id', async () => {
    await costcoRule();
    const { newId: _n, ...rest } = draft({ payee: 'costco' });
    const result = await preview({ ...rest, id: 'existing' });
    expect(result.result.category).toBeNull();
    expect(result.ruleFields).toEqual([]);
  });

  it('fills every field the person never touched, whatever it holds', async () => {
    await costcoRule();
    const result = await preview(
      draft({ payee: 'costco', category: 'dining', notes: 'Mine' }),
    );
    expect(result.result.category).toBe('groceries');
    expect(result.result.notes).toBe('Bulk');
  });

  // PR 453: a hand-set field is never changed, on any change; the rule's
  // value comes back as a suggestion instead
  it("never changes a hand-set field, and suggests the rule's value", async () => {
    await costcoRule();
    const result = await preview(
      draft({
        payee: 'costco',
        category: 'dining',
        notes: 'Mine',
        userFields: ['payee', 'category', 'notes'],
      }),
    );
    expect(result.result.category).toBe('dining');
    expect(result.result.notes).toBe('Mine');
    expect(result.ruleFields).toEqual([]);
    expect(result.suggestions).toEqual([
      {
        field: 'category',
        row: 0,
        value: { id: 'groceries', name: 'Groceries' },
      },
      { field: 'notes', row: 0, value: { text: 'Bulk' } },
    ]);
    // Taking a suggestion: the field leaves userFields and the rule sets it
    const taken = await preview(
      draft({
        payee: 'costco',
        category: 'dining',
        notes: 'Mine',
        userFields: ['payee', 'notes'],
      }),
    );
    expect(taken.result.category).toBe('groceries');
    expect(taken.ruleFields).toEqual(['category']);
    await expect(
      JSON.stringify(result.raw, null, 2) + '\n',
    ).toMatchFileSnapshot('./fixtures/transaction-preview-suggestions.json');
  });

  // PR 447 review of the rebuild: no rule may fire on a value of a hand-set
  // field the transaction will never have
  describe('chained rules', () => {
    const rule = (
      conditions: { op: string; field: string; value: unknown }[],
      actions: { op: string; field: string; value: unknown }[],
    ) =>
      insertRule({
        stage: null,
        conditionsOp: 'and',
        conditions,
        actions,
      } as never);

    it('never lets a later rule see a value a rule set on a hand-set field', async () => {
      await costcoRule();
      await rule(
        [{ op: 'is', field: 'category', value: 'groceries' }],
        [{ op: 'set', field: 'notes', value: 'food' }],
      );
      const result = await preview(
        draft({
          payee: 'costco',
          category: 'dining',
          userFields: ['payee', 'category'],
        }),
      );
      expect(result.result.category).toBe('dining');
      // costcoRule's own notes action still fills the untouched notes
      expect(result.result.notes).toBe('Bulk');
      expect(result.suggestions).toEqual([
        {
          field: 'category',
          row: 0,
          value: { id: 'groceries', name: 'Groceries' },
        },
      ]);
    });

    it('stops a three-rule chain at the hand-set field', async () => {
      await rule(
        [{ op: 'is', field: 'payee', value: 'corner' }],
        [{ op: 'set', field: 'category', value: 'groceries' }],
      );
      await rule(
        [{ op: 'is', field: 'category', value: 'groceries' }],
        [{ op: 'set', field: 'notes', value: 'food' }],
      );
      await rule(
        [{ op: 'is', field: 'notes', value: 'food' }],
        [{ op: 'set', field: 'cleared', value: true }],
      );
      const result = await preview(
        draft({
          payee: 'corner',
          category: 'dining',
          userFields: ['payee', 'category'],
        }),
      );
      expect(result.result).toMatchObject({
        category: 'dining',
        notes: '',
        cleared: false,
      });
      expect(result.ruleFields).toEqual([]);
      expect(result.suggestions.map(s => s.field)).toEqual(['category']);
      // Unprotected, the whole chain runs
      const free = await preview(
        draft({ payee: 'corner', userFields: ['payee'] }),
      );
      expect(free.result).toMatchObject({
        category: 'groceries',
        notes: 'food',
        cleared: true,
      });
    });

    it('confirms each suggestion with only that field freed', async () => {
      await rule(
        [{ op: 'is', field: 'payee', value: 'corner' }],
        [{ op: 'set', field: 'category', value: 'groceries' }],
      );
      await rule(
        [{ op: 'is', field: 'category', value: 'groceries' }],
        [{ op: 'set', field: 'notes', value: 'food' }],
      );
      // Notes would change only if the category were freed too, so freeing
      // notes alone suggests nothing for it
      const result = await preview(
        draft({
          payee: 'corner',
          category: 'dining',
          notes: 'mine',
          userFields: ['payee', 'category', 'notes'],
        }),
      );
      expect(result.result).toMatchObject({
        category: 'dining',
        notes: 'mine',
      });
      expect(result.suggestions.map(s => s.field)).toEqual(['category']);
    });
  });

  it('keeps a field the person cleared empty', async () => {
    await costcoRule();
    const result = await preview(
      draft({ payee: 'costco', userFields: ['payee', 'category'] }),
    );
    expect(result.result.category).toBeNull();
    expect(result.result.notes).toBe('Bulk');
    expect(result.suggestions.map(s => s.field)).toEqual(['category']);
  });

  it("suggests the amount a rule would set, with the engine's text", async () => {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'payee', value: 'costco' }],
      actions: [{ op: 'set', field: 'amount', value: -2500 }],
    });
    const result = await preview(
      draft({ payee: 'costco', userFields: ['payee', 'amount'] }),
    );
    expect(result.result.amount).toBe(-1000);
    expect(result.suggestions).toEqual([
      {
        field: 'amount',
        row: 0,
        value: { amount: -2500, amountText: '25.00' },
      },
    ]);
    const ruled = await preview(draft({ payee: 'costco' }));
    expect(ruled.result).toMatchObject({
      amount: -2500,
      amountText: '25.00',
      inflow: false,
    });
  });

  it("ignores only the budget's own currency symbol once a currency is set", async () => {
    await setPref('defaultCurrencyCode', 'AUD');
    for (const amountText of ['A$12.50', '$12.50', '12.50 A$']) {
      expect((await preview(draft({ amountText }))).amount, amountText).toBe(
        -1250,
      );
    }
    for (const amountText of ['€12', '£12']) {
      expect((await preview(draft({ amountText }))).errors, amountText).toEqual(
        { amount: 'amount-invalid' },
      );
    }
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
    await expect(
      JSON.stringify(result.raw, null, 2) + '\n',
    ).toMatchFileSnapshot('./fixtures/transaction-preview-split.json');
  });

  it('checks the split count before evaluating or looking up any child', async () => {
    const children = Array.from({ length: 2000 }, (_, i) => ({
      payee: `missing-${i}`,
      category: 'nope',
      notes: '',
      inflow: false,
      amountText: '1e20',
    }));
    const result = await preview(draft({ splits: children }));
    expect(result.errors).toEqual({ splits: 'split-limit' });
    expect(result.splitAmounts.every(a => a === null)).toBe(true);
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
    // An add's children are all new (PR 453)
    [
      {
        splits: [
          {
            id: 'x',
            category: null,
            notes: '',
            inflow: false,
            amountText: '1',
          },
        ],
      },
    ],
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

  it('refuses a draft that is not an object', async () => {
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
