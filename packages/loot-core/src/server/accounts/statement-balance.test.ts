// Scenarios from openspec/changes/reconcile-recorded-statement-balance (sc-4793)
import { Timestamp } from '@actual-app/crdt';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app as authApp } from '#server/auth/app';
import * as db from '#server/db';
import '#server/main';
import { app as preferencesApp } from '#server/preferences/app';
import { applyMessages, setSyncingMode } from '#server/sync';
import { undo } from '#server/undo';

import { app } from './app';

const KEY = 'statement-balance-acct1';
const save = (over: Record<string, unknown> = {}) =>
  app.handlers['account-statement-balance-save']({
    account_id: 'acct1',
    amount: 12345,
    source: 'entered',
    as_of: '2026-11-01',
    ...over,
  } as never);
const prefill = () =>
  app.handlers['account-statement-balance-prefill']({ account_id: 'acct1' });
const get = () =>
  app.handlers['account-statement-balance-get']({ account_id: 'acct1' });
const consume = (id: string, account_id = 'acct1') =>
  app.handlers['account-statement-balance-consume']({ account_id, id });
const stored = async () =>
  (
    await db.first<{ value: string }>(
      'SELECT value FROM preferences WHERE id = ?',
      [KEY],
    )
  )?.value;

const DAY = 86_400_000;
const setPref = (id: string, value: string) =>
  db.update('preferences', { id, value });
const bankAccount = (balance: number | null = 46541, over = {}) =>
  db.update('accounts', {
    id: 'acct1',
    account_sync_source: 'simpleFin',
    balance_current: balance,
    ...over,
  });
const stampAgo = (days: number) =>
  setPref('bank-balance-at-acct1', String(Date.now() - days * DAY));
const addTx = (amount: number, over = {}) =>
  db.insertTransaction({
    account: 'acct1',
    date: '2026-11-01',
    amount,
    cleared: false,
    ...over,
  });

beforeEach(async () => {
  await global.emptyDatabase()();
  await db.insertAccount({ id: 'acct1', name: 'Checking' });
  // The test clock starts near the epoch: a fixed "now" keeps ages positive
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-15T12:00:00Z'));
});
afterEach(() => {
  setSyncingMode('disabled');
  vi.restoreAllMocks();
});

describe('The statement balance record', () => {
  it('Save stamps id and entered_at from the engine and reads back', async () => {
    const before = Date.now();
    const rec = await save({ id: 'forged', entered_at: 1, consumed_at: 5 });
    expect(rec).toMatchObject({
      amount: 12345,
      source: 'entered',
      as_of: '2026-11-01',
      entered_by: 'app',
      consumed_at: null,
    });
    expect(rec.id).not.toBe('forged');
    expect(rec.id).toBeTruthy();
    expect(rec.entered_at).toBeGreaterThanOrEqual(before);
    expect(rec.entered_at).toBeLessThanOrEqual(Date.now());
    expect(await get()).toEqual(rec);
  });

  it('A new save replaces and unconsumes', async () => {
    const a = await save();
    await consume(a.id);
    const b = await save({ amount: 1 });
    expect(b.id).not.toBe(a.id);
    expect(await get()).toMatchObject({ amount: 1, consumed_at: null });
  });

  it('A malformed value reads as none', async () => {
    expect(await get()).toBeNull();
    const ok = {
      id: 'x',
      amount: 1,
      source: 'entered',
      entered_at: 1,
      entered_by: 'a',
      consumed_at: null,
    };
    for (const value of [
      'nope',
      '{"id":"x"}',
      JSON.stringify({ ...ok, amount: 1.5 }),
      JSON.stringify({ ...ok, source: 'bogus' }),
      JSON.stringify({ ...ok, entered_by: 'x'.repeat(101) }),
    ]) {
      await db.update('preferences', { id: KEY, value });
      expect(await get()).toBeNull();
    }
    await db.update('preferences', { id: KEY, value: JSON.stringify(ok) });
    expect(await get()).toMatchObject({ id: 'x', as_of: null });
  });

  it('Bad input is refused', async () => {
    await expect(save({ amount: 1.5 })).rejects.toThrow(/amount/);
    await expect(save({ source: 'model' })).rejects.toThrow(/source/);
    await expect(save({ as_of: 'tomorrow' })).rejects.toThrow(/as_of/);
    expect(await get()).toBeNull();
  });

  it('Consume is a compare-and-set on the id', async () => {
    const a = await save();
    const b = await save({ amount: 2 });
    expect(await consume(a.id)).toEqual({ consumed: false });
    expect((await get())?.consumed_at).toBeNull();
    expect(await consume(b.id, 'other')).toEqual({ consumed: false });
    expect(await consume(b.id)).toEqual({ consumed: true });
    expect((await get())?.consumed_at).toEqual(expect.any(Number));
    expect(await consume(b.id)).toEqual({ consumed: false });
  });

  it('An older save message arriving after a consume does not un-consume', async () => {
    setSyncingMode('enabled');
    const a = await save();
    const older = JSON.stringify({ ...a, consumed_at: null, amount: 99 });
    await consume(a.id);
    await applyMessages([
      {
        dataset: 'preferences',
        row: KEY,
        column: 'value',
        value: older,
        timestamp: Timestamp.parse(
          '1970-01-01T00:00:00.000Z-0000-0123456789ABCDEF',
        ) as Timestamp,
      },
    ]);
    expect((await get())?.consumed_at).toEqual(expect.any(Number));
    expect((await get())?.amount).toBe(12345);
  });

  it('Save and consume are not undoable', async () => {
    const a = await save();
    await consume(a.id);
    await undo();
    expect((await get())?.consumed_at).toEqual(expect.any(Number));
  });
});

describe('The generic preference save', () => {
  it('Refuses a statement-balance key and leaves the record', async () => {
    const rec = await save();
    await expect(
      preferencesApp.handlers['preferences/save']({
        id: KEY as never,
        value: JSON.stringify({ ...rec, amount: 1 }),
      }),
    ).rejects.toThrow(/statement balance/i);
    expect(await get()).toEqual(rec);
    expect(JSON.parse((await stored())!)).toEqual(rec);
  });

  it('Still saves other preferences', async () => {
    await preferencesApp.handlers['preferences/save']({
      id: 'budgetType',
      value: 'tracking',
    });
    expect(
      (await preferencesApp.handlers['preferences/get']()).budgetType,
    ).toBe('tracking');
  });
});

describe('The save derives who and checks the source (1.0a)', () => {
  const asUser = (user: Record<string, unknown> | null) =>
    vi
      .spyOn(authApp.handlers, 'subscribe-get-user')
      .mockResolvedValue(user as never);

  it('Derives entered_by from the signed-in user, whatever the caller sent', async () => {
    asUser({ displayName: 'Ken L', userName: 'ken' });
    expect((await save({ entered_by: 'Mallory' })).entered_by).toBe('Ken L');
    asUser({ displayName: null, userName: 'ken' });
    expect((await save()).entered_by).toBe('ken');
    asUser({ offline: false });
    expect((await save()).entered_by).toBe('app');
    asUser({ displayName: 'x'.repeat(300) });
    expect((await save()).entered_by).toHaveLength(100);
  });

  it('Falls back to app when the user cannot be read', async () => {
    vi.spyOn(authApp.handlers, 'subscribe-get-user').mockRejectedValue(
      new Error('offline'),
    );
    expect((await save()).entered_by).toBe('app');
  });

  it('Refuses a statement label', async () => {
    await expect(save({ source: 'statement' })).rejects.toThrow(/statement/);
    expect(await get()).toBeNull();
  });

  it('Refuses a bank-sync label unless the amount is the bank balance', async () => {
    await bankAccount();
    await expect(save({ source: 'bank-sync', amount: 1 })).rejects.toThrow(
      /bank/,
    );
    expect(await get()).toBeNull();
    expect(await save({ source: 'bank-sync', amount: 46541 })).toMatchObject({
      source: 'bank-sync',
    });
  });

  it('Refuses a bank-sync label on an account with no bank sync', async () => {
    await expect(save({ source: 'bank-sync', amount: 12345 })).rejects.toThrow(
      /bank/,
    );
  });

  it('Accepts a stale bank balance as bank-sync with its own date', async () => {
    await bankAccount();
    await stampAgo(12);
    expect(
      await save({ source: 'bank-sync', amount: 46541, as_of: '2026-11-02' }),
    ).toMatchObject({ source: 'bank-sync', as_of: '2026-11-02' });
  });

  it('Refuses a cleared label unless the amount is the live cleared balance, children left out', async () => {
    const parent = await addTx(-3000, { cleared: true, id: 'p' });
    await addTx(-1000, {
      cleared: true,
      id: 'c1',
      parent_id: parent,
      is_child: true,
    });
    await addTx(-2000, {
      cleared: true,
      id: 'c2',
      parent_id: parent,
      is_child: true,
    });
    await addTx(9999, { cleared: false });
    await expect(save({ source: 'cleared', amount: -6000 })).rejects.toThrow(
      /cleared/,
    );
    await expect(save({ source: 'cleared', amount: 12345 })).rejects.toThrow(
      /cleared/,
    );
    expect(await get()).toBeNull();
    expect(await save({ source: 'cleared', amount: -3000 })).toMatchObject({
      source: 'cleared',
    });
  });

  it('Accepts an entered label for any amount, even the cleared balance', async () => {
    await addTx(500, { cleared: true });
    expect(await save({ source: 'entered', amount: 500 })).toMatchObject({
      source: 'entered',
    });
    expect(await save({ source: 'entered', amount: 7 })).toMatchObject({
      amount: 7,
    });
  });
});

describe('account-statement-balance-prefill (1.1)', () => {
  it('Pre-fills a bank balance written within the window', async () => {
    await bankAccount();
    await stampAgo(1);
    const r = await prefill();
    expect(r.prefill).toMatchObject({
      amount: 46541,
      source: 'bank-sync',
      as_of: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(r.prefill?.link).toBeTruthy();
    expect(r.alternatives.map(a => a.source)).toEqual(['cleared']);
    expect(r.record).toBeNull();
  });

  it('Offers a stale bank balance as an alternative, not the pre-fill', async () => {
    await bankAccount();
    await stampAgo(12);
    const r = await prefill();
    expect(r.prefill).toBeNull();
    expect(r.alternatives.map(a => a.source)).toEqual(['bank-sync', 'cleared']);
    expect(r.alternatives[0]).toMatchObject({
      amount: 46541,
      source: 'bank-sync',
    });
  });

  it('Offers a balance with no write stamp, never pre-fills it, and says its date is unknown', async () => {
    await bankAccount();
    await db.update('accounts', { id: 'acct1', last_sync: String(Date.now()) });
    const r = await prefill();
    expect(r.prefill).toBeNull();
    expect(r.alternatives[0]).toMatchObject({
      source: 'bank-sync',
      as_of: null,
    });
  });

  it('Has no pre-fill and only the cleared alternative without a bank source', async () => {
    await addTx(500, { cleared: true });
    await stampAgo(0);
    await db.update('accounts', { id: 'acct1', balance_current: 46541 });
    const r = await prefill();
    expect(r.prefill).toBeNull();
    expect(r.alternatives).toEqual([
      expect.objectContaining({ amount: 500, source: 'cleared' }),
    ]);
    expect(r.cleared_balance).toBe(500);
  });

  it('Never pre-fills the cleared balance', async () => {
    await bankAccount(null);
    await addTx(500, { cleared: true });
    const r = await prefill();
    expect(r.prefill).toBeNull();
    expect(r.alternatives.map(a => a.source)).toEqual(['cleared']);
  });

  it('Leaves split children out of the cleared balance and reports the account type', async () => {
    await db.update('accounts', { id: 'acct1', type: 'credit' });
    const parent = await addTx(-3000, { cleared: true, id: 'p' });
    await addTx(-3000, {
      cleared: true,
      id: 'c1',
      parent_id: parent,
      is_child: true,
    });
    const r = await prefill();
    expect(r.cleared_balance).toBe(-3000);
    expect(r.account_type).toBe('credit');
  });

  it('Uses the max-age preference: 14 days keeps a 12-day-old balance as the pre-fill', async () => {
    await bankAccount();
    await stampAgo(12);
    await setPref('reconcile-bank-balance-max-age-days', '14');
    expect((await prefill()).prefill?.amount).toBe(46541);
  });

  it.each(['abc', '0', '31', '1e1', '0x7', '-3', '7.5', ''])(
    'Falls back to 7 days when the preference is %j',
    async bad => {
      await bankAccount();
      await setPref('reconcile-bank-balance-max-age-days', bad);
      await stampAgo(8);
      expect((await prefill()).prefill).toBeNull();
      await stampAgo(6);
      expect((await prefill()).prefill?.amount).toBe(46541);
    },
  );

  it('Accepts the ceiling of 30 days', async () => {
    await bankAccount();
    await setPref('reconcile-bank-balance-max-age-days', '30');
    await stampAgo(29);
    expect((await prefill()).prefill?.amount).toBe(46541);
  });

  it('Returns the record', async () => {
    const rec = await save();
    expect((await prefill()).record).toEqual(rec);
  });
});

describe('The generic preference save guards the stamp', () => {
  it('Refuses a bank-balance-at key', async () => {
    await expect(
      preferencesApp.handlers['preferences/save']({
        id: 'bank-balance-at-acct1' as never,
        value: String(Date.now()),
      }),
    ).rejects.toThrow(/bank balance/i);
  });
});
