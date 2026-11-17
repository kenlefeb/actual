// Scenarios from openspec/changes/reconcile-recorded-statement-balance (sc-4793)
import { Timestamp } from '@actual-app/crdt';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
    source: 'bank-sync',
    as_of: '2026-11-01',
    entered_by: 'app',
    ...over,
  } as never);
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

beforeEach(global.emptyDatabase());
afterEach(() => setSyncingMode('disabled'));

describe('The statement balance record', () => {
  it('Save stamps id and entered_at from the engine and reads back', async () => {
    const before = Date.now();
    const rec = await save({ id: 'forged', entered_at: 1, consumed_at: 5 });
    expect(rec).toMatchObject({
      amount: 12345,
      source: 'bank-sync',
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
    await expect(save({ entered_by: 'x'.repeat(101) })).rejects.toThrow(
      /entered_by/,
    );
    await expect(save({ amount: 1.5 })).rejects.toThrow(/amount/);
    await expect(save({ source: 'model' })).rejects.toThrow(/source/);
    await expect(save({ as_of: 'tomorrow' })).rejects.toThrow(/as_of/);
    expect(await get()).toBeNull();
    await save({ entered_by: 'x'.repeat(100) });
    expect(await get()).not.toBeNull();
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
