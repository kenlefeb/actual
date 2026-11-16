import { existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';
import type { Grant, Scope } from '#grants';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

const grant = (scopes: Scope[]): Grant => ({
  scopes,
  confirm_destructive: false,
});
const WRITE: Scope[] = ['budget:read', 'structure:write', 'schedules:write'];
const TOOL = 'write_set_account_business_days';

function auditLines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

async function start(g?: Grant) {
  h = await startHarness({ count: 1 }, g ? { grant: g } : { writes: true });
}

type Definition = Parameters<typeof api.createPaycheck>[0]['definition'];

async function paycheck(
  name: string,
  deposit: string,
  over: Partial<Definition> = {},
  clearing = '',
) {
  return api.createPaycheck({
    name,
    ...(clearing ? {} : { newClearingAccountName: `${name} Pay` }),
    definition: {
      payee: null,
      clearingAccount: clearing,
      date: { start: '2027-01-01', frequency: 'monthly' },
      weekendSolveMode: 'before',
      grossAmount: 300000,
      incomeCategory: null,
      deductions: [],
      deposits: [
        { id: `${name}-d`, account: deposit, kind: 'remainder', value: 0 },
      ],
      ...over,
    },
  });
}

async function definition(paycheckId: string) {
  return (await api.getPaychecks()).find(p => p.id === paycheckId)!.definition;
}

async function nextDates(paycheckId: string) {
  const d = await definition(paycheckId);
  const schedules = await api.getSchedules();
  const next = (id?: string | null) =>
    schedules.find(s => s.id === id)?.next_date ?? null;
  return {
    pay: next(d.paySchedule),
    deposits: d.deposits.map(x => next(x.schedule)),
  };
}

async function expectRefused(args: Record<string, unknown>, text?: RegExp) {
  const before = JSON.stringify(await api.getAccounts());
  const logged = auditLines().length;
  const res = await h.call(TOOL, args);
  expect(res.isError).toBe(true);
  expect(res.text).toMatch(text ?? /failed|validation/i);
  expect(JSON.stringify(await api.getAccounts())).toBe(before);
  expect(auditLines().length).toBe(logged);
}

const checkingId = () => h.fixture.accountId;

describe('write_set_account_business_days', () => {
  beforeEach(async () => start());

  it('Sets days early and matches the app on the same budget', async () => {
    const a = await paycheck('Alpha', checkingId());
    const other = await api.createAccount({ name: 'Other', offbudget: false });
    const b = await paycheck('Beta', other);
    const res = await h.call(TOOL, {
      account_id: checkingId(),
      business_calendar_id: null,
      deposit_days_early: 2,
    });
    expect(res.isError).toBe(false);
    await api.setAccountBusinessDays(other, {
      businessCalendarId: null,
      depositDaysEarly: 2,
    });
    const status = await h.call('get_account_budget_status', {
      account_id: checkingId(),
    });
    expect(status.json.deposit_days_early).toBe(2);
    expect((await nextDates(a)).deposits).toEqual(
      (await nextDates(b)).deposits,
    );
    expect(res.json.paychecks).toEqual([
      expect.objectContaining({ paycheck_id: a }),
    ]);
    expect(res.json.deposit_days_early).toEqual({ before: 0, after: 2 });
    expect(JSON.stringify(auditLines()[0])).toContain(a);
  });

  it('Out of range, an unknown calendar and no change are refused', async () => {
    await expectRefused({
      account_id: checkingId(),
      business_calendar_id: null,
      deposit_days_early: 11,
    });
    await expectRefused({
      account_id: checkingId(),
      business_calendar_id: 'nope',
      deposit_days_early: 1,
    });
    await expectRefused(
      {
        account_id: checkingId(),
        business_calendar_id: null,
        deposit_days_early: 0,
      },
      /Nothing to change/,
    );
    await expectRefused({
      account_id: 'Checking',
      business_calendar_id: null,
      deposit_days_early: 1,
    });
  });

  it('Both scopes are needed', async () => {
    await h.close();
    await start(grant(['budget:read', 'structure:write']));
    const res = await h.call(TOOL, {
      account_id: checkingId(),
      business_calendar_id: null,
      deposit_days_early: 1,
    });
    expect(res.text).toMatch(/missing schedules:write/);
    const status = await h.call('get_account_budget_status', {
      account_id: checkingId(),
    });
    expect(status.json.deposit_days_early).toBe(0);
  });

  it('Only deposit paychecks are counted', async () => {
    const savings = await api.createAccount({
      name: 'Savings',
      offbudget: false,
    });
    const deposit = await paycheck('Deposit', checkingId());
    const clearingOnly = await paycheck('Clearing', savings, {}, checkingId());
    const res = await h.call(TOOL, {
      account_id: checkingId(),
      business_calendar_id: null,
      deposit_days_early: 1,
    });
    expect(res.isError).toBe(false);
    expect(
      res.json.paychecks.map((p: { paycheck_id: string }) => p.paycheck_id),
    ).toEqual([deposit]);
    expect(res.json.also_regenerated).toEqual([clearingOnly]);
  });

  it('A skip is not dropped by default', async () => {
    const p = await paycheck('Skipped', checkingId());
    await api.skipNextPaycheck(p);
    const before = await nextDates(p);
    await expectRefused(
      {
        account_id: checkingId(),
        business_calendar_id: null,
        deposit_days_early: 2,
      },
      /allow_regenerate/,
    );
    expect(await nextDates(p)).toEqual(before);
  });

  it('allow_regenerate over a skip gives the app result', async () => {
    const other = await api.createAccount({ name: 'Other', offbudget: false });
    const a = await paycheck('Alpha', checkingId());
    const b = await paycheck('Beta', other);
    await api.skipNextPaycheck(a);
    await api.skipNextPaycheck(b);
    const res = await h.call(TOOL, {
      account_id: checkingId(),
      business_calendar_id: null,
      deposit_days_early: 2,
      allow_regenerate: true,
    });
    expect(res.isError).toBe(false);
    await api.setAccountBusinessDays(other, {
      businessCalendarId: null,
      depositDaysEarly: 2,
    });
    expect(await nextDates(a)).toEqual(await nextDates(b));
    const attempt = auditLines()[0];
    expect(attempt.allow_regenerate).toBe(true);
    expect(JSON.stringify(attempt)).toContain(a);
    expect(JSON.stringify(attempt)).toMatch(/skipped/);
  });

  describe('a deposit schedule deleted elsewhere', () => {
    async function withDeletedSchedule(
      over: Partial<Definition> = {},
      deposit = checkingId(),
      clearing = '',
    ) {
      const p = await paycheck('Gone', deposit, over, clearing);
      const d = await definition(p);
      await api.internal!.send('schedule/delete', {
        id: d.deposits[0].schedule!,
      });
      return p;
    }
    const args = {
      account_id: '',
      business_calendar_id: null,
      deposit_days_early: 2,
    };

    it('is not recreated by default', async () => {
      await withDeletedSchedule();
      const before = (await api.getSchedules()).length;
      await expectRefused(
        { ...args, account_id: checkingId() },
        /allow_regenerate/,
      );
      expect((await api.getSchedules()).length).toBe(before);
    });

    it('needs delete to be recreated', async () => {
      await h.close();
      await start(grant(WRITE));
      await withDeletedSchedule();
      const before = (await api.getSchedules()).length;
      const spy = vi.spyOn(api, 'setAccountBusinessDays');
      const res = await h.call(TOOL, {
        ...args,
        account_id: checkingId(),
        allow_regenerate: true,
      });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/missing delete/);
      expect(spy).not.toHaveBeenCalled();
      expect((await api.getSchedules()).length).toBe(before);
      const lines = auditLines();
      expect(lines.map(l => l.phase)).toEqual(['refused']);
      expect(lines[0].missing).toEqual(['delete']);
    });

    it('is recreated with delete, and the outcome records it', async () => {
      await h.close();
      await start(grant([...WRITE, 'delete']));
      const p = await withDeletedSchedule();
      const res = await h.call(TOOL, {
        ...args,
        account_id: checkingId(),
        allow_regenerate: true,
      });
      expect(res.isError).toBe(false);
      const d = await definition(p);
      const created = auditLines()[1].created;
      expect(created).toEqual([d.deposits[0].schedule]);
      expect((await api.getSchedules()).some(s => s.id === created[0])).toBe(
        true,
      );
    });

    it('counts a paycheck that only names the account elsewhere', async () => {
      await h.close();
      await start(grant(WRITE));
      const savings = await api.createAccount({
        name: 'Savings',
        offbudget: false,
      });
      // The account is only a deduction transfer target of this paycheck
      await withDeletedSchedule(
        {
          deductions: [
            {
              id: 'ded',
              name: '401k',
              amount: 1000,
              transferAccount: checkingId(),
            },
          ],
        },
        savings,
      );
      const before = (await api.getSchedules()).length;
      const res = await h.call(TOOL, {
        ...args,
        account_id: checkingId(),
        allow_regenerate: true,
      });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/missing delete/);
      expect((await api.getSchedules()).length).toBe(before);
    });
  });

  it('A flagged call that needs nothing behaves as if unflagged', async () => {
    const other = await api.createAccount({ name: 'Other', offbudget: false });
    await paycheck('Alpha', checkingId());
    await paycheck('Beta', other);
    const base = {
      business_calendar_id: null,
      deposit_days_early: 2,
    };
    const flagged = await h.call(TOOL, {
      account_id: checkingId(),
      allow_regenerate: true,
      ...base,
    });
    const plain = await h.call(TOOL, {
      account_id: other,
      ...base,
    });
    expect(flagged.isError).toBe(false);
    const strip = (o: Record<string, unknown>) => {
      const { account_id: _a, paychecks: _p, ...rest } = o;
      return rest;
    };
    expect(strip(flagged.json)).toEqual(strip(plain.json));
    const fields = (l: Record<string, unknown>) =>
      Object.keys(l).filter(k => k.startsWith('allow') || k === 'recreate');
    expect(fields(auditLines()[0])).toEqual(fields(auditLines()[2]));
  });

  it('No other account tool accepts allow_regenerate', async () => {
    const checking = checkingId();
    for (const [tool, args] of [
      ['write_update_account', { account_id: checking, name: 'X' }],
      ['write_reopen_account', { account_id: checking }],
      ['write_create_account', { name: 'X' }],
      ['write_create_account_group', { name: 'X' }],
      ['write_close_account', { account_id: checking }],
      ['write_delete_account', { account_id: checking }],
    ] as const) {
      const res = await h.call(tool, { ...args, allow_regenerate: true });
      expect(res.isError, tool).toBe(true);
    }
    expect((await api.getAccounts()).map(a => a.name)).toEqual(['Checking']);
  });
});
