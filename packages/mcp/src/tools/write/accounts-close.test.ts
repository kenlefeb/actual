import { existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';
import type { Grant, Scope } from '#grants';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

const grant = (scopes: Scope[], over: Partial<Grant> = {}): Grant => ({
  scopes,
  confirm_destructive: false,
  ...over,
});

const ALL_ACCOUNT: Scope[] = [
  'budget:read',
  'structure:write',
  'accounts:delete',
  'transactions:write',
  'schedules:write',
];

function auditLines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

const accounts = () => api.getAccounts();
const account = async (name: string) =>
  (await accounts()).find(a => a.name === name);

type Row = {
  id: string;
  account: string;
  amount: number;
  reconciled: boolean;
  payee: string | null;
  transfer_id: string | null;
};

async function rows(accountId: string) {
  const { data } = (await api.runQuery(
    api
      .q('transactions')
      .filter({ account: accountId })
      .select(['id', 'account', 'amount', 'reconciled', 'payee', 'transfer_id'])
      .options({ splits: 'all' }),
  )) as { data: Row[] };
  return data;
}

async function expectRefused(
  tool: string,
  args: Record<string, unknown>,
  text?: RegExp,
) {
  const before = JSON.stringify(await accounts());
  const logged = auditLines().length;
  const res = await h.call(tool, args);
  expect(res.isError).toBe(true);
  expect(res.text).toMatch(text ?? /failed|validation/i);
  expect(JSON.stringify(await accounts())).toBe(before);
  expect(auditLines().length).toBe(logged);
}

async function start(g?: Grant) {
  h = await startHarness({ count: 2 }, g ? { grant: g } : { writes: true });
}

/** Marks every row of an account reconciled. */
async function reconcile(accountId: string) {
  for (const r of await rows(accountId)) {
    await api.updateTransaction(r.id, { cleared: true, reconciled: true });
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/** An open account holding `balance` cents, as one deposit. */
async function funded(name: string, balance: number, offbudget = false) {
  return api.createAccount({ name, offbudget }, balance);
}

describe('write_close_account', () => {
  beforeEach(async () => start());

  it('Close with a balance moves it to the transfer account', async () => {
    const savings = await funded('Old Savings', 12000);
    const checking = (await account('Checking'))!;
    const checkingBefore = await api.getAccountBalance(checking.id);
    const res = await h.call('write_close_account', {
      account_id: savings,
      transfer_account_id: checking.id,
    });
    expect(res.isError).toBe(false);
    expect((await account('Old Savings'))!.closed).toBe(true);
    expect(await api.getAccountBalance(savings)).toBe(0);
    expect(await api.getAccountBalance(checking.id)).toBe(
      checkingBefore + 12000,
    );
    const [attempt, outcome] = auditLines();
    expect(attempt.phase).toBe('attempt');
    const closing = (await rows(savings)).find(r => r.amount === -12000)!;
    expect(outcome.created).toEqual([closing.id]);
  });

  it('A balance without a transfer account is refused', async () => {
    const savings = await funded('Old Savings', 12000);
    await expectRefused(
      'write_close_account',
      { account_id: savings },
      /transfer_account_id/,
    );
  });

  it('A bad transfer account is refused', async () => {
    const savings = await funded('Old Savings', 12000);
    const checking = (await account('Checking'))!;
    const gone = await funded('Gone', 100);
    await api.closeAccount(gone, checking.id);
    for (const transfer_account_id of [savings, 'nope', 'Checking', gone]) {
      await expectRefused('write_close_account', {
        account_id: savings,
        transfer_account_id,
      });
    }
  });

  it('A closed or unknown account is refused', async () => {
    const checking = (await account('Checking'))!;
    const old = await funded('Old', 500);
    await api.closeAccount(old, checking.id);
    await expectRefused('write_close_account', { account_id: old });
    await expectRefused('write_close_account', { account_id: 'nope' });
    await expectRefused('write_close_account', { account_id: 'Checking' });
  });

  it('transfer_category_id exactly when the transfer crosses the budget line', async () => {
    const off = await funded('Brokerage', 9000, true);
    const checking = (await account('Checking'))!;
    const cat = (await api.getCategories())[0].id;
    await expectRefused(
      'write_close_account',
      { account_id: off, transfer_account_id: checking.id },
      /transfer_category_id/,
    );
    await expectRefused(
      'write_close_account',
      {
        account_id: off,
        transfer_account_id: checking.id,
        transfer_category_id: 'nope',
      },
      /categories id/,
    );
    const on = await funded('Wallet', 100);
    await expectRefused(
      'write_close_account',
      {
        account_id: on,
        transfer_account_id: checking.id,
        transfer_category_id: cat,
      },
      /transfer_category_id/,
    );
    const ok = await h.call('write_close_account', {
      account_id: off,
      transfer_account_id: checking.id,
      transfer_category_id: cat,
    });
    expect(ok.isError).toBe(false);
  });

  it('A refused close never reaches the engine, which would unlink first', async () => {
    const off = await funded('Brokerage', 9000, true);
    const checking = (await account('Checking'))!;
    const spy = vi.spyOn(api, 'closeAccount');
    await expectRefused('write_close_account', {
      account_id: off,
      transfer_account_id: checking.id,
      transfer_category_id: 'nope',
    });
    await expectRefused('write_close_account', { account_id: off });
    expect(spy).not.toHaveBeenCalled();
  });

  it('An account with no transactions is deleted by a close', async () => {
    const empty = await api.createAccount({ name: 'Empty', offbudget: false });
    const res = await h.call('write_close_account', { account_id: empty });
    expect(res.isError).toBe(false);
    expect(res.json.deleted).toBe(true);
    expect(await account('Empty')).toBeUndefined();
  });

  it('The attempt line can reconstruct the account', async () => {
    const savings = await funded('Old Savings', 12000);
    const gid = await api.createAccountGroup({ name: 'Cash' });
    await api.updateAccount(savings, { account_group_id: gid });
    const checking = (await account('Checking'))!;
    await h.call('write_close_account', {
      account_id: savings,
      transfer_account_id: checking.id,
    });
    const text = JSON.stringify(auditLines()[0]);
    for (const want of [
      'Old Savings',
      gid,
      '12000',
      'bank_linked',
      'transactions',
      'reconciled',
    ]) {
      expect(text).toContain(want);
    }
  });

  it('The description says bank sync is unlinked', async () => {
    const t = (await h.client.listTools()).tools.find(
      x => x.name === 'write_close_account',
    )!;
    expect(t.description).toMatch(/bank sync/i);
    expect(t.description).toMatch(/cannot be undone|can't be undone/i);
    expect(t.annotations).toMatchObject({ destructiveHint: true });
  });

  it('Close needs accounts:delete', async () => {
    await h.close();
    await start(grant(['budget:read', 'structure:write']));
    const savings = await funded('Old Savings', 0);
    const res = await h.call('write_close_account', { account_id: savings });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/missing accounts:delete/);
    expect((await account('Old Savings'))!.closed).toBe(false);
  });

  it('Extra keys are refused', async () => {
    const savings = await funded('Old Savings', 0);
    await expectRefused('write_close_account', {
      account_id: savings,
      forced: true,
    });
  });

  describe('under confirm_destructive', () => {
    beforeEach(async () => {
      await h.close();
      await start(
        grant(['budget:read', 'structure:write', 'accounts:delete'], {
          confirm_destructive: true,
        }),
      );
    });

    it('A dry run, then confirm', async () => {
      const savings = await funded('Old Savings', 12000);
      const checking = (await account('Checking'))!;
      const args = { account_id: savings, transfer_account_id: checking.id };
      const dry = await h.call('write_close_account', args);
      expect(dry.json.dry_run).toBe(true);
      expect(JSON.stringify(dry.json)).toContain('12000');
      expect((await account('Old Savings'))!.closed).toBe(false);
      const done = await h.call('write_close_account', {
        ...args,
        confirm: dry.json.confirm,
      });
      expect(done.isError).toBe(false);
      expect((await account('Old Savings'))!.closed).toBe(true);
    });

    it('A stale confirm', async () => {
      const savings = await funded('Old Savings', 12000);
      const checking = (await account('Checking'))!;
      const args = { account_id: savings, transfer_account_id: checking.id };
      const dry = await h.call('write_close_account', args);
      await api.addTransactions(savings, [{ date: today(), amount: -100 }]);
      const res = await h.call('write_close_account', {
        ...args,
        confirm: dry.json.confirm,
      });
      expect(res.isError).toBe(true);
      expect((await account('Old Savings'))!.closed).toBe(false);
    });
  });
});

describe('write_delete_account', () => {
  beforeEach(async () => start());

  it('Delete a closed account is refused', async () => {
    const checking = (await account('Checking'))!;
    const old = await funded('Old', 500);
    await api.closeAccount(old, checking.id);
    await expectRefused('write_delete_account', { account_id: old }, /reopen/);
  });

  it('Delete an open account and its transactions', async () => {
    const checking = (await account('Checking'))!;
    const doomed = await funded('Doomed', 0);
    await api.addTransactions(doomed, [
      { date: today(), amount: -100 },
      { date: today(), amount: -200 },
    ]);
    const payees = await api.getPayees();
    const toDoomed = payees.find(p => p.transfer_acct === doomed)!;
    await api.addTransactions(
      checking.id,
      [{ date: today(), amount: -300, payee: toDoomed.id }],
      { runTransfers: true },
    );
    const partner = (await rows(checking.id)).find(r => r.amount === -300)!;
    expect(partner.transfer_id).not.toBeNull();
    const own = await rows(doomed);
    const res = await h.call('write_delete_account', { account_id: doomed });
    expect(res.isError).toBe(false);
    expect(await account('Doomed')).toBeUndefined();
    expect((await rows(doomed)).length).toBe(0);
    const left = (await rows(checking.id)).find(r => r.id === partner.id)!;
    expect(left.transfer_id).toBeNull();
    expect(left.payee).toBeNull();
    const attempt = JSON.stringify(auditLines()[0]);
    expect(attempt).toContain(partner.id);
    expect(attempt).toContain(String(own.length));
    expect(auditLines()[1].status).toBe('ok');
  });

  it('Delete needs transactions:write and accounts:delete', async () => {
    const doomed = await funded('Doomed', 0);
    for (const [scopes, missing] of [
      [
        ['budget:read', 'structure:write', 'accounts:delete'],
        'transactions:write',
      ],
      [
        ['budget:read', 'structure:write', 'transactions:write'],
        'accounts:delete',
      ],
    ] as const) {
      await h.close();
      await start(grant([...scopes]));
      const id = await funded('Doomed', 0);
      const res = await h.call('write_delete_account', { account_id: id });
      expect(res.text).toMatch(new RegExp(`missing ${missing}`));
      expect(await account('Doomed')).toBeDefined();
    }
    expect(doomed).toBeDefined();
  });

  it('Reconciled rows block a delete without the override', async () => {
    const doomed = await funded('Doomed', 0);
    await api.addTransactions(doomed, [
      { date: today(), amount: -100, cleared: true },
    ]);
    await reconcile(doomed);
    // The grant has no allow_reconciled: the call argument does not help
    await expectRefused('write_delete_account', { account_id: doomed });
    await expectRefused('write_delete_account', {
      account_id: doomed,
      allow_reconciled: true,
    });
    await h.close();
    await start(grant(ALL_ACCOUNT, { allow_reconciled: true }));
    const again = await funded('Doomed2', 0);
    await api.addTransactions(again, [
      { date: today(), amount: -100, cleared: true },
    ]);
    await reconcile(again);
    await expectRefused('write_delete_account', { account_id: again });
    const res = await h.call('write_delete_account', {
      account_id: again,
      allow_reconciled: true,
    });
    expect(res.isError).toBe(false);
    expect(await account('Doomed2')).toBeUndefined();
    expect(JSON.stringify(auditLines()[0])).toMatch(/reconciled/);
  });

  it('A reconciled transfer partner blocks a delete', async () => {
    const checking = (await account('Checking'))!;
    const doomed = await funded('Doomed', 0);
    const toDoomed = (await api.getPayees()).find(
      p => p.transfer_acct === doomed,
    )!;
    await api.addTransactions(
      checking.id,
      [
        {
          date: today(),
          amount: -300,
          payee: toDoomed.id,
          cleared: true,
        },
      ],
      { runTransfers: true },
    );
    await reconcile(checking.id);
    await expectRefused('write_delete_account', { account_id: doomed });
  });

  it('Over the row cap, counting split children', async () => {
    await h.close();
    await start(grant(ALL_ACCOUNT, { max_rows: 10 }));
    const big = await funded('Big', 0);
    // 4 plain rows plus a split parent with 6 children is 11 rows, 5 top-level
    await api.addTransactions(big, [
      ...Array.from({ length: 4 }, (_, i) => ({
        date: today(),
        amount: -(i + 1),
      })),
      {
        date: today(),
        amount: -600,
        subtransactions: Array.from({ length: 6 }, () => ({ amount: -100 })),
      },
    ]);
    expect((await rows(big)).length).toBe(11);
    await expectRefused('write_delete_account', { account_id: big });
  });

  it('An account that remains fails the outcome', async () => {
    const doomed = await funded('Doomed', 0);
    vi.spyOn(api, 'deleteAccount').mockResolvedValue(undefined as never);
    const res = await h.call('write_delete_account', { account_id: doomed });
    expect(auditLines()[1].status).toBe('failed');
    expect(JSON.stringify(res.json ?? res.text)).not.toMatch(/"deleted":true/);
  });

  it('The description says bank sync is unlinked and it is destructive', async () => {
    const t = (await h.client.listTools()).tools.find(
      x => x.name === 'write_delete_account',
    )!;
    expect(t.description).toMatch(/bank sync/i);
    expect(t.annotations).toMatchObject({ destructiveHint: true });
  });

  describe('under confirm_destructive', () => {
    beforeEach(async () => {
      await h.close();
      await start(grant(ALL_ACCOUNT, { confirm_destructive: true }));
    });

    it('A dry run with counts, then confirm', async () => {
      const doomed = await funded('Doomed', 0);
      await api.addTransactions(doomed, [{ date: today(), amount: -100 }]);
      const dry = await h.call('write_delete_account', { account_id: doomed });
      expect(dry.json.dry_run).toBe(true);
      expect(await account('Doomed')).toBeDefined();
      const done = await h.call('write_delete_account', {
        account_id: doomed,
        confirm: dry.json.confirm,
      });
      expect(done.isError).toBe(false);
      expect(await account('Doomed')).toBeUndefined();
    });

    it('A stale confirm', async () => {
      const doomed = await funded('Doomed', 0);
      const dry = await h.call('write_delete_account', { account_id: doomed });
      await api.addTransactions(doomed, [{ date: today(), amount: -100 }]);
      const res = await h.call('write_delete_account', {
        account_id: doomed,
        confirm: dry.json.confirm,
      });
      expect(res.isError).toBe(true);
      expect(await account('Doomed')).toBeDefined();
    });
  });
});

describe('account writes and undo', () => {
  it('Close and delete return a write_id and are not undoable', async () => {
    await start();
    const empty = await api.createAccount({ name: 'Empty', offbudget: false });
    const doomed = await funded('Doomed', 0);
    const closed = await h.call('write_close_account', { account_id: empty });
    const deleted = await h.call('write_delete_account', {
      account_id: doomed,
    });
    for (const res of [closed, deleted]) {
      expect(res.json.write_id).toEqual(expect.any(String));
      const line = auditLines().find(l => l.call_id === res.json.write_id);
      expect(line.schema).toBe(2);
      const undo = await h.call('write_undo', { write_id: res.json.write_id });
      expect(undo.isError).toBe(true);
    }
    const listed = (await h.call('list_writes')).json.writes;
    expect(listed.filter((x: { undoable: boolean }) => x.undoable)).toEqual([]);
  });
});
