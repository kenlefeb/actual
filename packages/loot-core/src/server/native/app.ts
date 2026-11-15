// Fork-only (sc-3584, ADR 11). Batched reads for native Apple screens: one
// message returns a whole view's numbers, so the native bridge never reads
// cells one by one. Read-only; the contract is in app.test.ts and its
// fixtures, which the Swift tests decode too.
import { createApp } from '#server/app';
import { aqlQuery } from '#server/aql';
import { getBudgetType } from '#server/budget/base';
import { app as businessCalendarsApp } from '#server/business-calendars/app';
import * as db from '#server/db';
import { mutator } from '#server/mutators';
import {
  createPaycheck,
  getPaychecks,
  isPaychecksOn,
  app as paychecksApp,
  setAccountBusinessDays,
  updatePaycheck,
} from '#server/paychecks/app';
import { refreshScheduleDateLookup } from '#server/schedules/app';
import * as sheet from '#server/sheet';
import {
  dropRedo,
  undo,
  undoable,
  undoGroupHasWrites,
  undoTargetMeta,
} from '#server/undo';
import { setBusinessCalendars } from '#shared/business-calendar-lookup';
import { getCurrency } from '#shared/currencies';
import * as monthUtils from '#shared/months';
import {
  changedDepositDaysEarly,
  computePaycheck,
  MAX_DEPOSIT_DAYS_EARLY,
  planPaycheck,
  validatePaycheckDraft,
} from '#shared/paychecks';
import type { PaycheckDraftError, PlannedPaycheck } from '#shared/paychecks';
import { q } from '#shared/query';
import { toRelativeDay } from '#shared/relative-dates';
import {
  DEFAULT_UPCOMING_SCHEDULE_DAYS,
  getHasTransactionsQuery,
  getNextDate,
  getScheduledAmount,
  getStatus,
} from '#shared/schedules';
import type { ScheduleStatusType } from '#shared/schedules';
import { parseNumberFormat } from '#shared/util';
import type { NumberFormats } from '#shared/util';
import type {
  CategoryEntity,
  CategoryGroupEntity,
  PaycheckDefinition,
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

export type NativePaycheckPreview = {
  netAmount: number;
  // The next pay date from today, moved off the clearing account's
  // non-business days; null when the pay dates can't be read
  payDate: string | null;
  // The employer's payee name; native names a new clearing account after it
  employerName: string | null;
  deposits: {
    id: string;
    amount: number;
    // The deposit's date for payDate, by its account's days early (the typed
    // value when valid, else the saved one) and calendar
    date: string | null;
    // The account's saved days early; null for an unknown account
    savedDaysEarly: number | null;
    // The account's business calendar; null means weekends only
    calendarName: string | null;
  }[];
  errors: PaycheckDraftError[];
};

export type NativeHandlers = {
  'native/budget-month': typeof budgetMonth;
  'native/schedules-paychecks': typeof schedulesPaychecks;
  'native/undo': typeof nativeUndo;
  'native/paycheck-preview': typeof paycheckPreview;
  'native/paycheck-save': typeof paycheckSave;
};

export const app = createApp<NativeHandlers>();
app.method('native/budget-month', budgetMonth);
app.method('native/schedules-paychecks', schedulesPaychecks);
app.method('native/undo', mutator(nativeUndo));
app.method('native/paycheck-preview', paycheckPreview);
// One undo step carrying Swift's token (design Decisions 4 and 5)
app.method(
  'native/paycheck-save',
  mutator(
    undoable(paycheckSave, args => ({ nativeUndoToken: args?.undoToken })),
  ),
);

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

/**
 * Undoes the latest undo step only when its marker carries `token`, the nonce
 * Swift sent with that native write (design Decision 5). Mutators run one at
 * a time, so nothing undoable lands between the check and the undo.
 */
async function nativeUndo({ token }: { token: string }) {
  const meta = undoTargetMeta() as { nativeUndoToken?: string } | undefined;
  if (!token || meta?.nativeUndoToken !== token) {
    throw new Error('native/undo: nothing to undo');
  }
  await undo();
}

type PaycheckAccount = {
  id: string;
  name: string;
  offbudget: number;
  closed: number;
  business_calendar_id: string | null;
  deposit_days_early: number | null;
};

async function readPaycheckAccounts() {
  return db.all<PaycheckAccount>(
    `SELECT id, name, offbudget, closed, business_calendar_id, deposit_days_early
     FROM accounts WHERE tombstone = 0`,
  );
}

// The checks the web form makes (validatePaycheckDraft), with the days early
// typed for each deposit account
function checkDraft(
  draft: {
    name: string;
    definition: PaycheckDefinition;
    isNewAccount: boolean;
    clearingName: string;
    daysEarly: Record<string, number>;
  },
  accounts: PaycheckAccount[],
) {
  const changed = changedDepositDaysEarly(
    draft.definition.deposits,
    Object.fromEntries(
      Object.entries(draft.daysEarly).map(([id, days]) => [id, String(days)]),
    ),
    new Map(accounts.map(a => [a.id, a.deposit_days_early ?? 0])),
  );
  const errors = validatePaycheckDraft({
    ...draft,
    clearing: accounts.find(a => a.id === draft.definition.clearingAccount),
    changedDaysEarly: changed,
  });
  return { changed, errors };
}

/**
 * What the native editor shows for a draft as the user edits it (sc-4343,
 * design Decision 3): net pay, each deposit's amount and date, the employer's
 * name and the web form's error codes. Read-only.
 */
async function paycheckPreview({
  name,
  definition,
  isNewAccount,
  newClearingAccountName = '',
  daysEarly = {},
}: {
  name: string;
  definition: PaycheckDefinition;
  isNewAccount: boolean;
  // The typed name of a new clearing account; empty uses the employer's
  newClearingAccountName?: string;
  // Days early typed for deposit accounts
  daysEarly?: Record<string, number>;
}): Promise<NativePaycheckPreview> {
  const calendars =
    await businessCalendarsApp.handlers['business-calendars-get']();
  setBusinessCalendars(calendars);
  const accounts = await readPaycheckAccounts();
  const byId = new Map(accounts.map(a => [a.id, a]));
  const employerName = definition.payee
    ? ((
        await db.first<{ name: string }>(
          'SELECT name FROM payees WHERE id = ? AND tombstone = 0',
          [definition.payee],
        )
      )?.name ?? null)
    : null;
  const { changed, errors } = checkDraft(
    {
      name,
      definition,
      isNewAccount,
      clearingName: newClearingAccountName.trim() || employerName || '',
      daysEarly,
    },
    accounts,
  );
  const { netAmount, depositAmounts } = computePaycheck(definition);
  const clearing = isNewAccount
    ? undefined
    : byId.get(definition.clearingAccount);

  let payDate: string | null = null;
  try {
    // As the pay schedule saves it (writePaycheckSchedules)
    payDate = getNextDate({
      op: 'isapprox',
      value: {
        ...definition.date,
        skipWeekend: true,
        weekendSolveMode: definition.weekendSolveMode,
        businessCalendarId: clearing?.business_calendar_id ?? undefined,
      },
    });
  } catch {
    // A half-typed recurrence has no date yet
  }
  if (payDate && !/^\d{4}-\d{2}-\d{2}$/.test(payDate)) payDate = null;

  return {
    netAmount,
    payDate,
    employerName,
    deposits: definition.deposits.map(deposit => {
      const account = byId.get(deposit.account);
      const offset =
        changed.find(c => c.account === deposit.account)?.days ??
        account?.deposit_days_early ??
        0;
      return {
        id: deposit.id,
        amount: depositAmounts.get(deposit.id) ?? 0,
        // As the deposit schedule's relative date (writePaycheckSchedules)
        date:
          payDate &&
          toRelativeDay(payDate, {
            relativeTo: {
              scheduleId: '',
              offset,
              unit: 'business-days',
              direction: 'before',
            },
            businessCalendarId: account?.business_calendar_id ?? undefined,
          }),
        savedDaysEarly: account ? (account.deposit_days_early ?? 0) : null,
        calendarName:
          calendars.find(c => c.id === account?.business_calendar_id)?.name ??
          null,
      };
    }),
    errors,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Saves the native editor's paycheck and its changed days early as one write
 * that fully applies or changes nothing, and is one undo step (sc-4343,
 * design Decision 4). Everything is checked before the first write; a later
 * throw reverts this group's writes, and only if it recorded any.
 */
async function paycheckSave(args: {
  // Absent for a new paycheck
  id?: string;
  name: string;
  definition: PaycheckDefinition;
  // A new paycheck creates its clearing account with this name
  newClearingAccountName?: string;
  // Days early for deposit accounts; unchanged values are skipped
  daysEarly: Record<string, number>;
  undoToken: string;
}): Promise<string> {
  const { id, name, definition, newClearingAccountName, daysEarly, undoToken } =
    args ?? ({} as typeof args);
  if (typeof undoToken !== 'string' || !undoToken) {
    throw new Error(
      'native/paycheck-save: a native write needs its undo token',
    );
  }
  if (
    (id !== undefined && (typeof id !== 'string' || !id)) ||
    typeof name !== 'string' ||
    !isObject(definition) ||
    !Array.isArray(definition.deposits) ||
    !Array.isArray(definition.deductions) ||
    (newClearingAccountName !== undefined &&
      typeof newClearingAccountName !== 'string') ||
    !isObject(daysEarly)
  ) {
    throw new Error('native/paycheck-save: invalid arguments');
  }
  const deposited = new Set(definition.deposits.map(d => d.account));
  for (const [account, days] of Object.entries(daysEarly)) {
    if (
      !deposited.has(account) ||
      !Number.isInteger(days) ||
      days < 0 ||
      days > MAX_DEPOSIT_DAYS_EARLY
    ) {
      throw new Error(
        `native/paycheck-save: invalid days early for ${account}`,
      );
    }
  }
  if (id && !(await getPaychecks()).some(p => p.id === id)) {
    throw new Error('Paycheck not found');
  }
  const isNewAccount = !id && !!newClearingAccountName?.trim();
  const accounts = await readPaycheckAccounts();
  const { changed, errors } = checkDraft(
    {
      name,
      definition,
      isNewAccount,
      clearingName: newClearingAccountName?.trim() ?? '',
      daysEarly,
    },
    accounts,
  );
  if (errors.length > 0) {
    throw new Error(
      `native/paycheck-save: invalid draft: ${errors.map(e => e.code).join(', ')}`,
    );
  }

  try {
    // Each runs the server validate() before its first write
    const saved = id
      ? (await updatePaycheck({ id, name: name.trim(), definition }), id)
      : await createPaycheck({
          name: name.trim(),
          definition: isNewAccount
            ? { ...definition, clearingAccount: '' }
            : definition,
          newClearingAccountName: isNewAccount
            ? newClearingAccountName?.trim()
            : undefined,
        });
    // After the paycheck, as the web saves; each rewrites every paycheck
    // depositing to the account
    for (const { account, days } of changed) {
      await setAccountBusinessDays({
        id: account,
        businessCalendarId:
          accounts.find(a => a.id === account)?.business_calendar_id ?? null,
        depositDaysEarly: days ?? 0,
      });
    }
    return saved;
  } catch (error) {
    // Reverting a group that wrote nothing would undo the step before it,
    // maybe a web edit
    if (undoGroupHasWrites()) {
      await undo();
      dropRedo();
    }
    throw error;
  }
}

// null: the cell doesn't exist for this budget type or row
function cell(sheetName: string, name: string) {
  return sheet.get().getCellValueLoose(sheetName, name) ?? null;
}
