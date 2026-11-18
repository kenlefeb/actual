// Run: yarn workspace @actual-app/core run perf (excluded from `yarn test`).
// Fork-only (sc-3602, native-add-transaction D5). On 5,000 payees, 40
// accounts, 150 categories, 300 rules (payee, notes and amount conditions and
// a split action) and a 50-child split, times the payee search, the two
// previews, the form read and a new transaction's save (ADR 11 gate: median
// under 50 ms). Prints the median and p95 every run.
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';
import { batchUpdateTransactions } from '#server/transactions';
import { insertRule, loadRules } from '#server/transactions/transaction-rules';

import { app } from './app';

const PAYEES = 5000;
const ACCOUNTS = 40;
const CATEGORIES = 150;
const RULES = 300;
const CHILDREN = 50;
const RUNS = 30;

const percentile = (sorted: number[], p: number) =>
  sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];

async function time(label: string, run: () => Promise<unknown>) {
  await run();
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = percentile(times, 0.5);
  // stderr, which the perf run prints (stdout is silenced)
  console.error(
    `${label}: median ${median.toFixed(1)} ms, p95 ${percentile(times, 0.95).toFixed(1)} ms`,
  );
  return median;
}

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  await loadMappings();
});

describe('native transaction form reads', () => {
  it('load within the 50 ms gate', async () => {
    for (let a = 0; a < ACCOUNTS; a++) {
      await db.insertAccount({ id: `a${a}`, name: `Account ${a}` });
      await db.insertPayee({
        id: `to-a${a}`,
        name: `Account ${a}`,
        transfer_acct: `a${a}`,
      });
    }
    await db.insertCategoryGroup({ id: 'g', name: 'Group' });
    for (let c = 0; c < CATEGORIES; c++) {
      await db.insertCategory({
        id: `c${c}`,
        name: `Cat ${c}`,
        cat_group: 'g',
      });
    }
    // Written straight into the table, as the accounts perf seed does
    for (let p = 0; p < PAYEES; p++) {
      db.runQuery(
        'INSERT INTO payees (id, name, favorite, tombstone) VALUES (?, ?, ?, 0)',
        [
          `p${p}`,
          `Payee ${p} ${String.fromCharCode(97 + (p % 26))}x`,
          p % 50 === 0 ? 1 : 0,
        ],
      );
      db.runQuery('INSERT INTO payee_mapping (id, targetId) VALUES (?, ?)', [
        `p${p}`,
        `p${p}`,
      ]);
    }
    for (let r = 0; r < RULES; r++) {
      const kind = r % 3;
      await insertRule({
        stage: null,
        conditionsOp: 'and',
        conditions:
          kind === 0
            ? [{ op: 'is', field: 'payee', value: `p${r}` }]
            : kind === 1
              ? [{ op: 'contains', field: 'notes', value: `memo ${r}` }]
              : [{ op: 'gt', field: 'amount', value: 100000 + r }],
        actions: [
          { op: 'set', field: 'category', value: `c${r % CATEGORIES}` },
        ],
      });
    }
    // The split action, on the payee the previews pick
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'payee', value: 'p3' }],
      actions: [
        {
          op: 'set-split-amount',
          value: 100,
          options: { splitIndex: 1, method: 'fixed-amount' },
        },
        {
          op: 'set-split-amount',
          value: null,
          options: { splitIndex: 2, method: 'remainder' },
        },
      ],
    });
    await loadRules();

    const children = Array.from({ length: CHILDREN }, (_, i) => ({
      id: `split/${i}`,
      account: 'a0',
      date: '2016-12-20',
      payee: `p${i}`,
      category: `c${i}`,
      amount: -100,
      is_child: true,
      parent_id: 'split',
    }));
    await batchUpdateTransactions({
      added: [
        {
          id: 'split',
          account: 'a0',
          date: '2016-12-20',
          payee: 'p1',
          amount: -100 * CHILDREN,
          is_parent: true,
        },
        ...children,
      ] as never,
    });

    const h = app.handlers;
    const draft = {
      newId: '0b5f2c1e-8d3a-4f6b-9c2d-1a2b3c4d5e6f',
      account: 'a0',
      date: '2016-12-20',
      payee: 'p3',
      payeeName: null,
      category: null,
      notes: '',
      cleared: false,
      inflow: false,
      amountText: '25.00',
      splits: [],
      userFields: [],
    };
    const splitDraft = {
      ...draft,
      payee: 'p1',
      amountText: String(CHILDREN),
      splits: children.map(c => ({
        payee: c.payee,
        category: c.category,
        notes: '',
        inflow: false,
        amountText: '1',
      })),
    };

    expect(
      await time('native/payees, two letters', async () => {
        const { payees } = await h['native/payees']({ search: 'ax' });
        expect(payees).toHaveLength(50);
      }),
    ).toBeLessThan(50);
    expect(
      await time('native/payees, empty search', async () => {
        const { payees } = await h['native/payees']({ search: '' });
        expect(payees).toHaveLength(50);
      }),
    ).toBeLessThan(50);
    expect(
      await time('native/transaction-preview, payee change', async () => {
        const result = await h['native/transaction-preview']({
          draft,
        });
        expect(result.result.splits).toHaveLength(2);
      }),
    ).toBeLessThan(50);
    expect(
      await time(
        'native/transaction-preview, amount change on the 50-child split',
        async () => {
          const result = await h['native/transaction-preview']({
            draft: splitDraft,
          });
          expect(result.remaining).toBe(0);
        },
      ),
    ).toBeLessThan(50);
    // PR 453: suggestions for hand-set fields, on a single row and on the split
    expect(
      await time(
        'native/transaction-preview, payee change with three hand-set fields',
        async () => {
          const result = await h['native/transaction-preview']({
            draft: {
              ...draft,
              category: 'c1',
              notes: 'mine',
              cleared: true,
              userFields: ['payee', 'category', 'notes', 'cleared'],
            },
          });
          expect(result.suggestions.length).toBeGreaterThan(0);
        },
      ),
    ).toBeLessThan(50);
    expect(
      await time(
        'native/transaction-preview, the 50-child split with three hand-set fields',
        async () => {
          const result = await h['native/transaction-preview']({
            draft: {
              ...splitDraft,
              payee: 'p3',
              notes: 'mine',
              cleared: true,
              userFields: ['payee', 'notes', 'cleared', 'splits'],
            },
          });
          expect(result.result.splits).toHaveLength(CHILDREN);
        },
      ),
    ).toBeLessThan(50);
    expect(
      await time('native/transaction-form, the split', async () => {
        const { transaction } = await h['native/transaction-form']({
          id: 'split',
        });
        expect(transaction?.splits).toHaveLength(CHILDREN);
      }),
    ).toBeLessThan(50);
    // D3: every rule is checked against the draft, and none applies to this payee
    expect(
      await time('native/transaction-save, a new transaction', async () => {
        const newId = crypto.randomUUID();
        const { id } = await h['native/transaction-save']({
          draft: { ...draft, newId, payee: 'p4000' },
          undoToken: newId,
        });
        expect(id).toBe(newId);
      }),
    ).toBeLessThan(50);
  }, 600_000);
});
