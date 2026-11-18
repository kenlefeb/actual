// Fork-only (sc-4341). `native/undo({token})` undoes only the native write
// that recorded that token as its undo marker's meta (design Decision 5).
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { app as paychecksApp } from '#server/paychecks/app';
import * as prefs from '#server/prefs';
import { app as schedulesApp } from '#server/schedules/app';
import { loadRules } from '#server/transactions/transaction-rules';
import { clearUndo, undo, undoTargetMeta } from '#server/undo';
import { setBusinessCalendars } from '#shared/business-calendar-lookup';
import { businessCalendarPresets } from '#shared/business-calendar-presets';
import { q } from '#shared/query';
import type { PaycheckDefinition } from '#types/models';

import { app } from './app';

const handlers = paychecksApp.handlers;
const nativeUndo = (token: string) => app.handlers['native/undo']({ token });

const definition: PaycheckDefinition = {
  payee: 'acme',
  clearingAccount: 'clearing',
  date: {
    start: '2026-11-01',
    frequency: 'monthly',
    patterns: [
      { type: 'day', value: 15 },
      { type: 'day', value: -1 },
    ],
  },
  weekendSolveMode: 'before',
  grossAmount: 300000,
  incomeCategory: 'income',
  deductions: [],
  deposits: [
    { id: 'checking', account: 'checking', kind: 'remainder', value: 0 },
  ],
};

async function addAccount(id: string) {
  await db.insertAccount({ id, name: id });
  await db.insertPayee({ id: `transfer-${id}`, name: '', transfer_acct: id });
}

async function payNextDate(id: string) {
  const paycheck = (await handlers['paychecks-get']()).find(p => p.id === id);
  const { data } = await aqlQuery(
    q('schedules')
      .filter({ id: paycheck?.definition.paySchedule })
      .select('next_date'),
  );
  return data[0]?.next_date;
}

const daysEarly = async (id: string) =>
  (
    await db.first<{ deposit_days_early: number }>(
      'SELECT deposit_days_early FROM accounts WHERE id = ?',
      [id],
    )
  )?.deposit_days_early;

let paycheck = '';

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  await loadMappings();
  await loadRules();
  schedulesApp.startServices();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 1));
  setBusinessCalendars([
    { id: 'federal', name: 'Federal', ...businessCalendarPresets[0].calendar },
  ]);
  await addAccount('clearing');
  await addAccount('checking');
  await db.insertPayee({ id: 'acme', name: 'Acme' });
  await db.insertCategoryGroup({ id: 'ig', name: 'Income', is_income: 1 });
  await db.insertCategory({
    id: 'income',
    name: 'Income',
    cat_group: 'ig',
    is_income: 1,
  });
  paycheck = await handlers['paycheck-create']({ name: 'Acme', definition });
  clearUndo();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('native/undo', () => {
  it('undoes the native skip that carries the token', async () => {
    await handlers['paycheck-skip-next']({ id: paycheck, undoToken: 'T' });
    expect(await payNextDate(paycheck)).toBe('2026-11-30');

    await nativeUndo('T');

    expect(await payNextDate(paycheck)).toBe('2026-11-13');
  });

  it('refuses when another undoable write ran since', async () => {
    await handlers['paycheck-skip-next']({ id: paycheck, undoToken: 'T' });
    // A web write in between
    await handlers['account-set-business-days']({
      id: 'checking',
      businessCalendarId: null,
      depositDaysEarly: 3,
    });

    await expect(nativeUndo('T')).rejects.toThrow(/^\[native:undo-nothing\] /);

    expect(await payNextDate(paycheck)).toBe('2026-11-30');
    expect(await daysEarly('checking')).toBe(3);
  });

  it('refuses an unknown token and changes nothing', async () => {
    await handlers['paycheck-skip-next']({ id: paycheck, undoToken: 'T' });

    await expect(nativeUndo('made-up')).rejects.toThrow(
      /^\[native:undo-nothing\] /,
    );
    await expect(nativeUndo('')).rejects.toThrow(/^\[native:undo-nothing\] /);

    expect(await payNextDate(paycheck)).toBe('2026-11-30');
  });

  it('never undoes a web edit when the token write recorded nothing', async () => {
    // A paycheck with no schedules: its skip writes nothing
    await db.insert('paychecks', {
      id: 'empty',
      name: 'Empty',
      definition: JSON.stringify({ ...definition, deposits: [] }),
    });
    await handlers['account-set-business-days']({
      id: 'checking',
      businessCalendarId: null,
      depositDaysEarly: 4,
    });
    await handlers['paycheck-skip-next']({ id: 'empty', undoToken: 'T' });

    await expect(nativeUndo('T')).rejects.toThrow(/^\[native:undo-nothing\] /);

    expect(await daysEarly('checking')).toBe(4);
  });

  it('keeps web calls without a token as they were', async () => {
    await handlers['paycheck-skip-next']({ id: paycheck });
    expect(undoTargetMeta()).toBeUndefined();

    await undo();

    expect(await payNextDate(paycheck)).toBe('2026-11-13');
  });

  it('records the token on a native delete', async () => {
    await handlers['paycheck-delete']({ id: paycheck, undoToken: 'D' });
    expect(await handlers['paychecks-get']()).toEqual([]);

    await nativeUndo('D');

    expect((await handlers['paychecks-get']()).map(p => p.id)).toEqual([
      paycheck,
    ]);
  });
});
