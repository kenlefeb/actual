import type { SyncResponseWithErrors } from '#server/accounts/app';
import * as db from '#server/db';
import * as sheet from '#server/sheet';
import { getBankSyncError } from '#shared/errors';
import { setScheduleDates } from '#shared/schedule-date-lookup';
import type { ServerHandlers } from '#types/server-handlers';

import { app as accountGroupsApp } from './account-groups/app';
import { app as accountsApp } from './accounts/app';
import { installAPI } from './api';
import { createBudget } from './budget/base';
import * as prefs from './prefs';
import { app as transactionsApp } from './transactions/app';

vi.mock('#shared/errors', () => ({
  getBankSyncError: vi.fn(error => `Bank sync error: ${error.message}`),
}));

describe('API handlers', () => {
  const handlers = installAPI({} as unknown as ServerHandlers);
  const originalBatchUpdate = handlers['transactions-batch-update'];

  describe('api/get-server-version', () => {
    beforeEach(() => {
      prefs.unloadPrefs();
    });

    it('does not require an open budget', async () => {
      handlers['get-server-version'] = vi
        .fn()
        .mockResolvedValue({ version: '26.6.0' });

      await expect(handlers['api/get-server-version']()).resolves.toEqual({
        version: '26.6.0',
      });
    });
  });

  describe('api/bank-sync', () => {
    const syncResult = ({
      newTransactions = [],
      matchedTransactions = [],
      updatedAccounts = [],
      errors = [],
    }: Partial<SyncResponseWithErrors> = {}): SyncResponseWithErrors => ({
      newTransactions,
      matchedTransactions,
      updatedAccounts,
      errors,
    });

    // A real sync error is an object, and the handler reads two fields off it:
    // getBankSyncError(errors[0]) for the message and errors[0].code for the
    // code it attaches. A bare string satisfies neither.
    const syncError = {
      type: 'SyncError' as const,
      accountId: 'account2',
      message: 'connection-failed',
      category: 'ACCOUNT_NEEDS_ATTENTION',
      code: 'ACCOUNT_NEEDS_ATTENTION',
    };

    it('should sync a single account when accountId is provided', async () => {
      handlers['accounts-bank-sync'] = vi.fn().mockResolvedValue(syncResult());

      await handlers['api/bank-sync']({ accountId: 'account1' });
      expect(handlers['accounts-bank-sync']).toHaveBeenCalledWith({
        ids: ['account1'],
      });
    });

    it('should handle errors in non batch sync', async () => {
      handlers['accounts-bank-sync'] = vi
        .fn()
        .mockResolvedValue(syncResult({ errors: [syncError] }));

      await expect(
        handlers['api/bank-sync']({ accountId: 'account2' }),
      ).rejects.toThrow('Bank sync error: connection-failed');

      expect(getBankSyncError).toHaveBeenCalledWith(syncError);
    });

    it('attaches the error code to the thrown error', async () => {
      handlers['accounts-bank-sync'] = vi
        .fn()
        .mockResolvedValue(syncResult({ errors: [syncError] }));

      await expect(
        handlers['api/bank-sync']({ accountId: 'account2' }),
      ).rejects.toMatchObject({ code: 'ACCOUNT_NEEDS_ATTENTION' });
    });

    it('returns what the sync reconciled for a single account', async () => {
      handlers['accounts-bank-sync'] = vi.fn().mockResolvedValue(
        syncResult({
          newTransactions: ['t1', 't2'],
          matchedTransactions: ['t3'],
          updatedAccounts: ['account1'],
        }),
      );

      await expect(
        handlers['api/bank-sync']({ accountId: 'account1' }),
      ).resolves.toEqual({
        newTransactions: ['t1', 't2'],
        matchedTransactions: ['t3'],
        updatedAccounts: ['account1'],
      });
    });

    it('returns empty arrays when a sync reconciled nothing', async () => {
      handlers['accounts-bank-sync'] = vi.fn().mockResolvedValue(syncResult());

      // The caller has to be able to tell this apart from a sync that imported
      // something; both are successful, so an error is not the signal.
      await expect(
        handlers['api/bank-sync']({ accountId: 'account1' }),
      ).resolves.toEqual({
        newTransactions: [],
        matchedTransactions: [],
        updatedAccounts: [],
      });
    });

    it('merges results across both paths of a batch sync', async () => {
      handlers['accounts-get'] = vi.fn().mockResolvedValue([
        { id: 'simplefin1', account_sync_source: 'simpleFin' },
        { id: 'gocardless1', account_sync_source: 'goCardless' },
      ]);
      handlers['simplefin-batch-sync'] = vi.fn().mockResolvedValue([
        {
          accountId: 'simplefin1',
          res: syncResult({
            newTransactions: ['sf1'],
            updatedAccounts: ['simplefin1'],
          }),
        },
      ]);
      handlers['accounts-bank-sync'] = vi.fn().mockResolvedValue(
        syncResult({
          newTransactions: ['gc1'],
          matchedTransactions: ['gc2'],
          updatedAccounts: ['gocardless1'],
        }),
      );

      await expect(handlers['api/bank-sync']()).resolves.toEqual({
        newTransactions: ['sf1', 'gc1'],
        matchedTransactions: ['gc2'],
        updatedAccounts: ['simplefin1', 'gocardless1'],
      });

      // SimpleFIN accounts go through their own batch endpoint and must not be
      // synced a second time by the generic path.
      expect(handlers['accounts-bank-sync']).toHaveBeenCalledWith({
        ids: ['gocardless1'],
      });
    });

    it('still throws on error rather than returning partial results', async () => {
      handlers['accounts-get'] = vi
        .fn()
        .mockResolvedValue([
          { id: 'gocardless1', account_sync_source: 'goCardless' },
        ]);
      handlers['accounts-bank-sync'] = vi.fn().mockResolvedValue(
        syncResult({
          newTransactions: ['gc1'],
          errors: [syncError],
        }),
      );

      await expect(handlers['api/bank-sync']()).rejects.toThrow(
        'Bank sync error: connection-failed',
      );
    });
  });

  describe('api/account-groups', () => {
    beforeEach(global.emptyDatabase());

    beforeEach(async () => {
      await prefs.loadPrefs();

      handlers['account-groups-get'] =
        accountGroupsApp.handlers['account-groups-get'];
      handlers['account-group-create'] =
        accountGroupsApp.handlers['account-group-create'];
      handlers['account-group-update'] =
        accountGroupsApp.handlers['account-group-update'];
      handlers['account-group-delete'] =
        accountGroupsApp.handlers['account-group-delete'];
      handlers['accounts-get'] = accountsApp.handlers['accounts-get'];
    });

    it('round-trips account groups and exposes account_group_id on accounts', async () => {
      const id = await handlers['api/account-group-create']({
        group: { name: 'Savings' },
      });
      await expect(handlers['api/account-groups-get']()).resolves.toEqual([
        { id, name: 'Savings' },
      ]);

      await handlers['api/account-group-update']({
        id,
        fields: { name: 'ISAs' },
      });
      await expect(handlers['api/account-groups-get']()).resolves.toEqual([
        { id, name: 'ISAs' },
      ]);

      await db.insertAccount({ id: 'acct1', name: 'Marcus' });
      await handlers['api/account-update']({
        id: 'acct1',
        fields: { account_group_id: id },
      });
      const accounts = await handlers['api/accounts-get']();
      expect(accounts[0]).toMatchObject({ id: 'acct1', account_group_id: id });

      await handlers['api/account-group-delete']({ id });
      await expect(handlers['api/account-groups-get']()).resolves.toEqual([]);
      const after = await handlers['api/accounts-get']();
      expect(after[0].account_group_id).toBeNull();
    });
  });

  describe('api/account-statement-balance', () => {
    beforeEach(global.emptyDatabase());

    beforeEach(async () => {
      await prefs.loadPrefs();
      for (const name of [
        'account-statement-balance-save',
        'account-statement-balance-get',
        'account-statement-balance-consume',
        'account-create',
        'account-close',
        'account-reopen',
        'accounts-get',
      ] as const) {
        // @ts-expect-error - tests wire real handlers into the API's table
        handlers[name] = accountsApp.handlers[name];
      }
    });

    it('The API offers a read and a consume and no way to save', () => {
      const names = Object.keys(handlers).filter(
        name => name.startsWith('api/') && /statement-balance/.test(name),
      );
      expect(names.sort()).toEqual([
        'api/account-statement-balance-consume',
        'api/account-statement-balance-get',
      ]);
    });

    it('Reads and consumes by id, compare-and-set', async () => {
      await db.insertAccount({ id: 'acct1', name: 'Checking' });
      const rec = await handlers['account-statement-balance-save']({
        account_id: 'acct1',
        amount: 500,
        source: 'entered',
      });
      await expect(
        handlers['api/account-statement-balance-get']({ accountId: 'acct1' }),
      ).resolves.toEqual(rec);
      await expect(
        handlers['api/account-statement-balance-consume']({
          accountId: 'acct1',
          id: 'not-it',
        }),
      ).resolves.toEqual({ consumed: false });
      await expect(
        handlers['api/account-statement-balance-consume']({
          accountId: 'acct1',
          id: rec.id,
        }),
      ).resolves.toEqual({ consumed: true });
    });

    it('The api/ handlers that write accounts or preferences leave a record unchanged', async () => {
      await db.insertAccount({ id: 'acct1', name: 'Checking' });
      const rec = await handlers['account-statement-balance-save']({
        account_id: 'acct1',
        amount: 500,
        source: 'entered',
      });
      const key = 'statement-balance-acct1';
      const attempts: Array<() => Promise<unknown>> = [
        () =>
          handlers['api/account-update']({
            id: key,
            fields: { name: JSON.stringify({ ...rec, amount: 1 }) },
          }),
        () =>
          handlers['api/account-update']({
            id: 'acct1',
            // @ts-expect-error - a hostile payload naming the record's key
            fields: { [key]: JSON.stringify({ ...rec, amount: 1 }), value: 1 },
          }),
        () =>
          handlers['api/account-create']({
            account: { name: key, offbudget: false, closed: false },
          }),
        () => handlers['api/account-close']({ id: key }),
        () => handlers['api/account-reopen']({ id: key }),
        () => handlers['api/account-delete']({ id: key }),
      ];
      for (const attempt of attempts) {
        await attempt().catch(() => undefined);
      }
      await expect(
        handlers['api/account-statement-balance-get']({ accountId: 'acct1' }),
      ).resolves.toEqual(rec);
    });
  });

  describe('api/budget-month', () => {
    beforeEach(global.emptyDatabase());

    beforeEach(async () => {
      global.currentMonth = '2026-01';

      await sheet.loadSpreadsheet(db);
      await prefs.loadPrefs();

      await db.insertCategoryGroup({
        id: 'income-group',
        name: 'Income',
        is_income: 1,
      });
      await db.insertCategory({
        id: 'income-cat',
        name: 'Salary',
        cat_group: 'income-group',
        is_income: 1,
      });

      await db.insertAccount({ id: 'acct1', name: 'Checking' });

      handlers['get-budget-bounds'] = vi
        .fn()
        .mockResolvedValue({ start: '2026-01', end: '2026-12' });
    });

    afterEach(() => {
      global.currentMonth = null;
    });

    it('envelope budget: income group returns only received', async () => {
      await createBudget(['2026-02', '2026-03']);
      await db.insertTransaction({
        id: 'tx1',
        date: '2026-03-15',
        account: 'acct1',
        amount: 5000,
        category: 'income-cat',
      });
      await sheet.waitOnSpreadsheet();

      const result = await handlers['api/budget-month']({ month: '2026-03' });
      const group = result.categoryGroups.find(g => g.is_income);
      assert(group, 'Expected income category group to exist');

      expect(group).toHaveProperty('received', 5000);
      expect(group).not.toHaveProperty('budgeted');
      expect(group).not.toHaveProperty('balance');
      expect(group?.categories?.[0]).toHaveProperty('received', 5000);
      expect(group?.categories?.[0]).not.toHaveProperty('budgeted');
      expect(group?.categories?.[0]).not.toHaveProperty('balance');
    });

    it('tracking budget: income group returns budgeted, received, and balance', async () => {
      sheet.get().meta().budgetType = 'tracking';
      await db.update('preferences', { id: 'budgetType', value: 'tracking' });

      await createBudget(['2026-02', '2026-03']);
      sheet.get().set('budget202603!budget-income-cat', 6000);
      await db.insertTransaction({
        id: 'tx1',
        date: '2026-03-15',
        account: 'acct1',
        amount: 5000,
        category: 'income-cat',
      });
      await sheet.waitOnSpreadsheet();

      const result = await handlers['api/budget-month']({ month: '2026-03' });
      const group = result.categoryGroups.find(g => g.is_income);
      assert(group, 'Expected income category group to exist');

      expect(group).toHaveProperty('budgeted', 6000);
      expect(group).toHaveProperty('received', 5000);
      expect(group).toHaveProperty('balance', 1000);
      expect(group?.categories?.[0]).toHaveProperty('budgeted', 6000);
      expect(group?.categories?.[0]).toHaveProperty('received', 5000);
      expect(group?.categories?.[0]).toHaveProperty('balance', 1000);
      expect(group?.categories?.[0]).toHaveProperty('carryover', false);
    });
  });

  describe('transaction mutation completion', () => {
    beforeEach(global.emptyDatabase());

    // These tests replace the batch-update handler; put it back for later tests
    afterEach(() => {
      handlers['transactions-batch-update'] = originalBatchUpdate;
    });

    beforeEach(async () => {
      await prefs.loadPrefs();
      await db.insertAccount({ id: 'mutation-account', name: 'Checking' });
      await db.insertTransaction({
        id: 'mutation-transaction',
        account: 'mutation-account',
        date: '2026-10-25',
        amount: -9900,
        notes: 'Original note',
      });
    });

    test.each(['update', 'delete'] as const)(
      '%s awaits the asynchronous batch result',
      async operation => {
        let complete: () => void = () => undefined;
        const transaction = await db.getTransaction('mutation-transaction');
        assert(transaction);
        const result = {
          added: [],
          updated: [transaction],
          deleted: [transaction],
          errors: [],
        };
        const batch = new Promise<typeof result>(resolve => {
          complete = () => resolve(result);
        });
        handlers['transactions-batch-update'] = vi.fn(() => batch);

        const pending =
          operation === 'update'
            ? handlers['api/transaction-update']({
                id: 'mutation-transaction',
                fields: { notes: 'Updated note' },
              })
            : handlers['api/transaction-delete']({
                id: 'mutation-transaction',
              });

        complete();
        await expect(pending).resolves.toEqual([transaction]);
        expect(handlers['transactions-batch-update']).toHaveBeenCalledOnce();
      },
    );

    test.each(['update', 'delete'] as const)(
      '%s propagates batch failures to the caller',
      async operation => {
        handlers['transactions-batch-update'] = vi
          .fn()
          .mockRejectedValue(new Error('Batch write failed'));

        const pending =
          operation === 'update'
            ? handlers['api/transaction-update']({
                id: 'mutation-transaction',
                fields: { notes: 'Updated note' },
              })
            : handlers['api/transaction-delete']({
                id: 'mutation-transaction',
              });

        await expect(pending).rejects.toThrow('Batch write failed');
      },
    );
  });

  describe('api/transactions-update', () => {
    beforeEach(global.emptyDatabase());

    afterEach(() => {
      handlers['transactions-batch-update'] = originalBatchUpdate;
    });

    let toChecking = '';
    beforeEach(async () => {
      await prefs.loadPrefs();
      // The engine's own batch update, so transfers and splits run for real
      handlers['transactions-batch-update'] =
        transactionsApp.handlers['transactions-batch-update'];
      await db.insertAccount({ id: 'checking', name: 'Checking' });
      await db.insertAccount({ id: 'savings', name: 'Savings' });
      toChecking = await db.insertPayee({
        name: '',
        transfer_acct: 'checking',
      });
      const toSavings = await db.insertPayee({
        name: '',
        transfer_acct: 'savings',
      });
      // A transfer of -50.00 from Checking to Savings, both dated 2026-11-10
      await db.insertTransaction({
        id: 'out',
        account: 'checking',
        date: '2026-11-10',
        amount: -5000,
        payee: toSavings,
        transfer_id: 'in',
      });
      await db.insertTransaction({
        id: 'in',
        account: 'savings',
        date: '2026-11-10',
        amount: 5000,
        payee: toChecking,
        transfer_id: 'out',
      });
      // A split of -100.00 with children -60.00 and -40.00
      await db.insertTransaction({
        id: 'parent',
        account: 'checking',
        date: '2026-11-01',
        amount: -10000,
        is_parent: true,
      });
      for (const [id, amount] of [
        ['child1', -6000],
        ['child2', -4000],
      ] as const) {
        await db.insertTransaction({
          id,
          account: 'checking',
          date: '2026-11-01',
          amount,
          is_child: true,
          parent_id: 'parent',
        });
      }
    });

    async function amounts(...ids: string[]) {
      return Promise.all(
        ids.map(async id => (await db.getTransaction(id))?.amount),
      );
    }

    test("A split's parent and children together", async () => {
      await handlers['api/transactions-update']({
        updates: [
          { id: 'parent', fields: { amount: -12000 } },
          { id: 'child1', fields: { amount: -8000 } },
        ],
      });
      expect(await amounts('parent', 'child1', 'child2')).toEqual([
        -12000, -8000, -4000,
      ]);
      expect((await db.getTransaction('parent'))?.error).toBeFalsy();
    });

    test('One update fails', async () => {
      await expect(
        handlers['api/transactions-update']({
          updates: [
            { id: 'out', fields: { notes: 'changed' } },
            { id: 'missing', fields: { notes: 'changed' } },
          ],
        }),
      ).rejects.toThrow();
      expect((await db.getTransaction('out'))?.notes).toBeNull();
    });

    test('A transfer follows', async () => {
      await handlers['api/transactions-update']({
        updates: [{ id: 'out', fields: { amount: -7500, date: '2026-11-14' } }],
      });
      const [out, inside] = await Promise.all([
        db.getTransaction('out'),
        db.getTransaction('in'),
      ]);
      expect(out).toMatchObject({ amount: -7500, date: '2026-11-14' });
      expect(inside).toMatchObject({ amount: 7500, date: '2026-11-10' });
    });

    test('The transfer step fails', async () => {
      // Checking loses its transfer payee, so updateTransfer throws
      db.runQuery(
        'UPDATE payees SET transfer_acct = NULL WHERE id = ?',
        [toChecking],
        false,
      );
      await expect(
        handlers['api/transactions-update']({
          updates: [{ id: 'out', fields: { amount: -7500 } }],
        }),
      ).rejects.toThrow();
      expect(await amounts('out', 'in')).toEqual([-7500, 5000]);
    });
  });

  // Runs after the describes above, in file order
  test('leaves the batch-update handler as it was for later tests', () => {
    expect(handlers['transactions-batch-update']).toBe(originalBatchUpdate);
  });

  describe('api/rule-create', () => {
    beforeEach(global.emptyDatabase());

    beforeEach(async () => {
      await prefs.loadPrefs();
    });

    test.each(['default', null, 'pre', 'post'] as const)(
      'normalizes %s input at the API boundary',
      async stage => {
        const rule = {
          stage,
          conditionsOp: 'and' as const,
          conditions: [],
          actions: [],
        };
        const internalRule = {
          id: 'rule-id',
          ...rule,
          stage: stage === 'default' ? null : stage,
        };

        handlers['rule-add'] = vi.fn().mockResolvedValue(internalRule);

        await expect(handlers['api/rule-create']({ rule })).resolves.toEqual(
          internalRule,
        );
        expect(handlers['rule-add']).toHaveBeenCalledWith({
          ...rule,
          stage: internalRule.stage,
        });
      },
    );
  });

  describe('api/rule-update', () => {
    beforeEach(global.emptyDatabase());

    beforeEach(async () => {
      await prefs.loadPrefs();
    });

    test('normalizes default input at the API boundary', async () => {
      const rule = {
        id: 'rule-id',
        stage: 'default' as const,
        conditionsOp: 'and' as const,
        conditions: [],
        actions: [],
      };
      const internalRule = { ...rule, stage: null };

      handlers['rule-update'] = vi.fn().mockResolvedValue(internalRule);

      await expect(handlers['api/rule-update']({ rule })).resolves.toEqual(
        internalRule,
      );
      expect(handlers['rule-update']).toHaveBeenCalledWith(internalRule);
    });
  });

  describe('api/schedule-dates-get', () => {
    afterEach(() => setScheduleDates([]));

    it('expands a date relative to another schedule', async () => {
      setScheduleDates([
        ['payday', { start: '2016-12-15', frequency: 'monthly' }],
      ]);

      await expect(
        handlers['api/schedule-dates-get']({
          date: {
            relativeTo: {
              scheduleId: 'payday',
              offset: 2,
              unit: 'business-days',
              direction: 'before',
            },
          },
          start: '2017-01-01',
          count: 2,
        }),
      ).resolves.toEqual(['2017-01-12', '2017-02-13']);
    });

    it('rejects a relative date with an invalid offset', async () => {
      await expect(
        handlers['api/schedule-dates-get']({
          date: {
            relativeTo: {
              scheduleId: 'payday',
              offset: -1,
              unit: 'days',
              direction: 'after',
            },
          },
          start: '2017-01-01',
          count: 2,
        }),
      ).rejects.toThrow('offset');
    });
  });
});
