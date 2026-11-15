// Fork-only (sc-3584, ADR 11). Batched reads for native Apple screens: one
// message returns a whole view's numbers, so the native bridge never reads
// cells one by one. Read-only; the contract is in app.test.ts and its
// fixtures, which the Swift tests decode too.
import { createApp } from '#server/app';
import { aqlQuery } from '#server/aql';
import { getBudgetType } from '#server/budget/base';
import { app as businessCalendarsApp } from '#server/business-calendars/app';
import * as db from '#server/db';
import {
  getPaychecks,
  isPaychecksOn,
  app as paychecksApp,
} from '#server/paychecks/app';
import { refreshScheduleDateLookup } from '#server/schedules/app';
import * as sheet from '#server/sheet';
import { setBusinessCalendars } from '#shared/business-calendar-lookup';
import { getCurrency } from '#shared/currencies';
import * as monthUtils from '#shared/months';
import { planPaycheck } from '#shared/paychecks';
import type { PlannedPaycheck } from '#shared/paychecks';
import { q } from '#shared/query';
import {
  DEFAULT_UPCOMING_SCHEDULE_DAYS,
  getHasTransactionsQuery,
  getScheduledAmount,
  getStatus,
} from '#shared/schedules';
import type { ScheduleStatusType } from '#shared/schedules';
import { parseNumberFormat } from '#shared/util';
import type { NumberFormats } from '#shared/util';
import type {
  CategoryEntity,
  CategoryGroupEntity,
  ScheduleEntity,
  TransactionEntity,
} from '#types/models';

// null: the value doesn't apply to this budget type (or row)
type Amount = number | null;

export type NativeBudgetMonthCategory = {
  id: string;
  name: string;
  hidden: boolean;
  budgeted: Amount;
  spent: Amount;
  balance: Amount;
  carryover: boolean;
};

export type NativeBudgetMonthGroup = {
  id: string;
  name: string;
  isIncome: boolean;
  hidden: boolean;
  budgeted: Amount;
  spent: Amount;
  balance: Amount;
  categories: NativeBudgetMonthCategory[];
};

export type NativeBudgetMonth = {
  month: string;
  // The budget's earliest and latest month (YYYY-MM), from the months loot-core
  // already holds; reading them creates nothing. Omitted if there are none.
  firstMonth?: string;
  lastMonth?: string;
  budgetType: 'envelope' | 'tracking';
  // How the web formats money (useFormat.ts), so native amounts read the
  // same: the currency (the web's fallback for an unknown code is none, '' with
  // 2 places) and the formatting preferences
  currencyCode: string;
  currencyDecimalPlaces: number;
  currencySymbol: string;
  currencySymbolPosition: 'before' | 'after';
  currencySpace: boolean;
  numberFormat: NumberFormats;
  hideFraction: boolean;
  totals: {
    budgeted: Amount;
    spent: Amount;
    income: Amount;
    balance: Amount;
    // envelope only
    toBudget: Amount;
    available: Amount;
    lastMonthOverspent: Amount;
    forNextMonth: Amount;
    fromLastMonth: Amount;
    // tracking only
    budgetedIncome: Amount;
    saved: Amount;
  };
  groups: NativeBudgetMonthGroup[];
};

type NativeCurrency = Pick<
  NativeBudgetMonth,
  | 'currencyCode'
  | 'currencyDecimalPlaces'
  | 'currencySymbol'
  | 'currencySymbolPosition'
  | 'currencySpace'
  | 'numberFormat'
  | 'hideFraction'
>;

type NativePlannedPaycheck = {
  date: string;
  deposits: (PlannedPaycheck['deposits'][number] & { accountName: string })[];
};

export type NativePaycheck = {
  id: string;
  name: string;
  netAmount: number;
  next: NativePlannedPaycheck | null;
  skipped: string[];
  later: NativePlannedPaycheck[];
  // Present only while the web shows its clearing warning
  clearingWarning: {
    clearingAccount: string;
    clearingAccountName: string;
    balance: number;
    missingDeposits: { id: string; account: string; accountName: string }[];
  } | null;
};

export type NativeSchedule = {
  id: string;
  name: string | null;
  payeeName: string | null;
  accountName: string | null;
  nextDate: string | null;
  // The web list's amount: approximate or between shows a ~
  amount: number;
  isApprox: boolean;
  completed: boolean;
  status: ScheduleStatusType;
};

export type NativeSchedulesPaychecks = NativeCurrency & {
  // The paychecks feature flag; native shows the web screens while false
  enabled: boolean;
  summary: {
    hasPaychecks: boolean;
    nextDate: string | null;
    netAmount: number | null;
    scheduleCount: number;
    anyWarning: boolean;
  };
  paychecks: NativePaycheck[];
  schedules: NativeSchedule[];
};

export type NativeHandlers = {
  'native/budget-month': typeof budgetMonth;
  'native/schedules-paychecks': typeof schedulesPaychecks;
};

export const app = createApp<NativeHandlers>();
app.method('native/budget-month', budgetMonth);
app.method('native/schedules-paychecks', schedulesPaychecks);

async function budgetMonth({
  month,
}: {
  month: string;
}): Promise<NativeBudgetMonth> {
  const sheetName = /^\d{4}-\d{2}$/.test(month)
    ? monthUtils.sheetForMonth(month)
    : null;
  if (!sheetName || cell(sheetName, 'total-budgeted') === null) {
    throw new Error(`native/budget-month: no budget for month ${month}`);
  }
  const amount = (name: string): Amount => {
    const value = cell(sheetName, name);
    // An uncomputed cell holds '', which the web UI shows as 0
    return value === null ? null : typeof value === 'number' ? value : 0;
  };
  const isEnvelope = getBudgetType() !== 'tracking';
  const envelope = (name: string) => (isEnvelope ? amount(name) : null);
  const tracking = (name: string) => (isEnvelope ? null : amount(name));

  const created = [...(sheet.get().meta().createdMonths as Set<string>)].sort();

  const { data: groups } = (await aqlQuery(
    q('category_groups').select('*'),
  )) as { data: CategoryGroupEntity[] };

  const currency = await readCurrency();

  return {
    month,
    ...(created.length > 0 && {
      firstMonth: created[0],
      lastMonth: created[created.length - 1],
    }),
    budgetType: isEnvelope ? 'envelope' : 'tracking',
    ...currency,
    totals: {
      budgeted: amount('total-budgeted'),
      spent: amount('total-spent'),
      income: amount('total-income'),
      balance: amount('total-leftover'),
      toBudget: envelope('to-budget'),
      available: envelope('available-funds'),
      lastMonthOverspent: envelope('last-month-overspent'),
      forNextMonth: envelope('buffered'),
      fromLastMonth: envelope('from-last-month'),
      budgetedIncome: tracking('total-budget-income'),
      saved: tracking('real-saved'),
    },
    groups: groups.map(group => ({
      id: group.id,
      name: group.name,
      isIncome: Boolean(group.is_income),
      hidden: Boolean(group.hidden),
      budgeted: amount(`group-budget-${group.id}`),
      spent: amount(`group-sum-amount-${group.id}`),
      balance: amount(`group-leftover-${group.id}`),
      categories: (group.categories ?? []).map((cat: CategoryEntity) => ({
        id: cat.id,
        name: cat.name,
        hidden: Boolean(cat.hidden),
        budgeted: amount(`budget-${cat.id}`),
        spent: amount(`sum-amount-${cat.id}`),
        balance: amount(`leftover-${cat.id}`),
        carryover: Boolean(cell(sheetName, `carryover-${cat.id}`)),
      })),
    })),
  };
}

// How the web formats money (useFormat.ts)
async function readCurrency(): Promise<NativeCurrency> {
  const prefs = await db.all<{ id: string; value: string | null }>(
    `SELECT id, value FROM preferences WHERE id IN
       ('defaultCurrencyCode', 'numberFormat', 'hideFraction',
        'currencySymbolPosition', 'currencySpaceBetweenAmountAndSymbol')`,
  );
  const pref = (id: string) => prefs.find(p => p.id === id)?.value ?? undefined;
  const currency = getCurrency(pref('defaultCurrencyCode') ?? '');
  const { format: numberFormat, hideFraction } = parseNumberFormat({
    format: pref('numberFormat'),
    hideFraction: pref('hideFraction'),
  });
  return {
    currencyCode: currency.code,
    currencyDecimalPlaces: currency.decimalPlaces,
    currencySymbol: currency.symbol,
    currencySymbolPosition:
      pref('currencySymbolPosition') === 'after' ? 'after' : 'before',
    currencySpace: pref('currencySpaceBetweenAmountAndSymbol') === 'true',
    numberFormat,
    hideFraction,
  };
}

/**
 * The Schedules & Paychecks screen in one read (sc-4341): each paycheck's plan
 * from the web's own `planPaycheck`, in the web's order, with its clearing
 * warning; the schedules the web lists (every paycheck's own left out) with
 * their statuses; and the summary the Budget-tab row shows.
 */
async function schedulesPaychecks(): Promise<NativeSchedulesPaychecks> {
  // The lookups the date math reads, as withScheduleLookups fills them on the
  // web; the sync listeners refresh them asynchronously, so refresh here
  await refreshScheduleDateLookup();
  setBusinessCalendars(
    await businessCalendarsApp.handlers['business-calendars-get'](),
  );

  const paychecks = await getPaychecks();
  const paySchedules = paychecks.flatMap(p => p.definition.paySchedule ?? []);
  // The web's query (PaychecksSection), so splits and tombstones match
  const { data: payTransactions } = (await aqlQuery(
    q('transactions')
      .filter({ schedule: { $oneof: paySchedules } })
      .select(['schedule', 'date']),
  )) as { data: Pick<TransactionEntity, 'schedule' | 'date'>[] };
  const { data: allSchedules } = (await aqlQuery(
    q('schedules').select('*'),
  )) as { data: ScheduleEntity[] };
  const scheduleById = new Map(allSchedules.map(s => [s.id, s]));

  const accounts = await db.all<{ id: string; name: string }>(
    'SELECT id, name FROM accounts',
  );
  const accountName = (id: string) =>
    accounts.find(a => a.id === id)?.name ?? '';
  const payees = await db.all<{ id: string; name: string }>(
    'SELECT id, name FROM payees',
  );

  // currentDay(), as the web passes; read from the clock like the clearing
  // status, so tests can set it
  const today = monthUtils.dayFromDate(new Date());
  const clearing = await paychecksApp.handlers['paychecks-clearing-status']();
  const withNames = ({ date, deposits }: PlannedPaycheck) => ({
    date,
    deposits: deposits.map(d => ({
      ...d,
      accountName: accountName(d.account),
    })),
  });
  const planned: NativePaycheck[] = paychecks
    .map(paycheck => {
      const plan = planPaycheck(
        paycheck,
        scheduleById,
        today,
        payTransactions.flatMap(t =>
          t.schedule === paycheck.definition.paySchedule ? t.date : [],
        ),
      );
      const status = clearing.find(c => c.paycheck === paycheck.id);
      return {
        id: paycheck.id,
        name: paycheck.name,
        netAmount: plan.netAmount,
        next: plan.next && withNames(plan.next),
        skipped: plan.skipped,
        later: plan.later.map(withNames),
        clearingWarning: status?.isWarning
          ? {
              clearingAccount: status.clearingAccount,
              clearingAccountName: accountName(status.clearingAccount),
              balance: status.balance,
              missingDeposits: status.missingDeposits.map(d => ({
                id: d.id,
                account: d.account,
                accountName: accountName(d.account),
              })),
            }
          : null,
      };
    })
    // As PaychecksSection: paychecks without a next date (e.g. ended) go last
    .sort((a, b) =>
      (a.next?.date ?? '9999').localeCompare(b.next?.date ?? '9999'),
    );

  // As the web lists: a paycheck's schedules are reached from its row
  const own = new Set(
    paychecks.flatMap(({ definition }) =>
      [definition.paySchedule, ...definition.deposits.map(d => d.schedule)]
        // Never null after a save; older or corrupt rows may lack them
        .filter((id): id is string => !!id),
    ),
  );
  const listed = allSchedules.filter(s => !own.has(s.id));
  // useSchedules' statuses
  const { data: hasTransRows } = (await aqlQuery(
    getHasTransactionsQuery(listed),
  )) as { data: Pick<TransactionEntity, 'schedule'>[] };
  const hasTrans = new Set(hasTransRows.map(row => row.schedule));
  const upcomingLength =
    (
      await db.first<{ value: string }>(
        "SELECT value FROM preferences WHERE id = 'upcomingScheduledTransactionLength'",
      )
    )?.value ?? DEFAULT_UPCOMING_SCHEDULE_DAYS;
  const schedules: NativeSchedule[] = listed.map(s => ({
    id: s.id,
    name: s.name || null,
    payeeName: payees.find(p => p.id === s._payee)?.name ?? null,
    accountName: accounts.find(a => a.id === s._account)?.name ?? null,
    nextDate: s.next_date || null,
    amount: getScheduledAmount(s._amount),
    isApprox: s._amountOp === 'isapprox' || s._amountOp === 'isbetween',
    completed: Boolean(s.completed),
    status: getStatus(
      s.next_date,
      s.completed,
      hasTrans.has(s.id),
      s.custom_upcoming_length ?? upcomingLength,
    ),
  }));

  const first = planned[0];
  return {
    ...(await readCurrency()),
    enabled: await isPaychecksOn(),
    summary: {
      hasPaychecks: planned.length > 0,
      nextDate: first?.next?.date ?? null,
      netAmount: first?.next ? first.netAmount : null,
      // What the list shows by default: completed ones sit behind "Show
      // completed schedules", as on the web
      scheduleCount: schedules.filter(s => !s.completed).length,
      anyWarning: planned.some(p => p.clearingWarning !== null),
    },
    paychecks: planned,
    schedules,
  };
}

// null: the cell doesn't exist for this budget type or row
function cell(sheetName: string, name: string) {
  return sheet.get().getCellValueLoose(sheetName, name) ?? null;
}
