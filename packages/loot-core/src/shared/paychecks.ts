import type {
  AccountEntity,
  PaycheckDefinition,
  PaycheckDeposit,
  PaycheckEntity,
  ScheduleEntity,
} from '#types/models';

import * as monthUtils from './months';
import {
  getRelativeOccurrences,
  isRelativeDate,
  toRelativeDay,
} from './relative-dates';

// Most business days early an account's direct deposits can arrive
export const MAX_DEPOSIT_DAYS_EARLY = 10;

export type PaycheckError =
  | 'deductions-exceed-gross'
  | 'deposits-exceed-net'
  | 'percents-exceed-100'
  | 'multiple-remainders'
  | 'deposits-do-not-add-up'
  | 'no-deposits';

export type PaycheckTotals = {
  netAmount: number;
  // Deposit id -> amount in cents
  depositAmounts: Map<PaycheckDeposit['id'], number>;
  errors: PaycheckError[];
};

type PaycheckAmounts = Pick<
  PaycheckDefinition,
  'grossAmount' | 'deductions' | 'deposits'
>;

/**
 * Net pay and each deposit's amount, in cents. Percent deposits round half
 * away from zero and the remainder deposit takes what is left, so rounding
 * never leaves money in the clearing account.
 */
export function computePaycheck({
  grossAmount,
  deductions,
  deposits,
}: PaycheckAmounts): PaycheckTotals {
  const errors: PaycheckError[] = [];
  const deducted = deductions.reduce((sum, d) => sum + d.amount, 0);
  const netAmount = grossAmount - deducted;
  if (netAmount < 0) {
    errors.push('deductions-exceed-gross');
  }

  const depositAmounts = new Map<PaycheckDeposit['id'], number>();
  let assigned = 0;
  let percentTotal = 0;
  for (const deposit of deposits) {
    if (deposit.kind === 'remainder') {
      continue;
    }
    const amount =
      deposit.kind === 'fixed'
        ? deposit.value
        : Math.round((netAmount * deposit.value) / 100);
    if (deposit.kind === 'percent') {
      percentTotal += deposit.value;
    }
    depositAmounts.set(deposit.id, amount);
    assigned += amount;
  }

  const remainders = deposits.filter(d => d.kind === 'remainder');
  for (const deposit of remainders) {
    depositAmounts.set(deposit.id, netAmount - assigned);
  }
  // Without a remainder, percents totalling 100 give the last one the rounding
  // (compared in hundredths so float sums like 33.33 + 33.33 + 33.34 match)
  const lastPercent = deposits.filter(d => d.kind === 'percent').at(-1);
  if (
    remainders.length === 0 &&
    lastPercent &&
    Math.round(percentTotal * 100) === 10000
  ) {
    const rounded = depositAmounts.get(lastPercent.id) ?? 0;
    depositAmounts.set(lastPercent.id, rounded + netAmount - assigned);
    assigned = netAmount;
  }

  if (deposits.length === 0) {
    errors.push('no-deposits');
  }
  if (percentTotal > 100) {
    errors.push('percents-exceed-100');
  }
  if (remainders.length > 1) {
    errors.push('multiple-remainders');
  }
  if (assigned > netAmount) {
    errors.push('deposits-exceed-net');
  } else if (
    deposits.length > 0 &&
    remainders.length === 0 &&
    assigned !== netAmount
  ) {
    errors.push('deposits-do-not-add-up');
  }
  return { netAmount, depositAmounts, errors };
}

export type PlannedDeposit = {
  id: string;
  account: AccountEntity['id'];
  amount: number;
  date: string;
};

export type PlannedPaycheck = { date: string; deposits: PlannedDeposit[] };

export type PaycheckPlan = {
  netAmount: number;
  next: PlannedPaycheck | null;
  // Occurrences before the next one that were skipped, not posted early
  skipped: string[];
  later: PlannedPaycheck[];
};

/**
 * The next paycheck (the pay schedule's stored next date, so it includes
 * skips), any skipped before it and the three after it, each with the date
 * every deposit is expected for that pay date. `postedDates` are the dates of
 * the pay schedule's posted transactions.
 */
export function planPaycheck(
  { definition }: PaycheckEntity,
  scheduleById: Map<ScheduleEntity['id'], ScheduleEntity>,
  today: string,
  postedDates: string[],
): PaycheckPlan {
  const { netAmount, depositAmounts } = computePaycheck(definition);
  const pay = definition.paySchedule
    ? scheduleById.get(definition.paySchedule)
    : undefined;
  if (!pay?.next_date || pay.completed) {
    return { netAmount, next: null, skipped: [], later: [] };
  }

  const atPayDate = (date: string): PlannedPaycheck => ({
    date,
    deposits: definition.deposits.map(deposit => {
      const schedule = deposit.schedule
        ? scheduleById.get(deposit.schedule)
        : undefined;
      return {
        id: deposit.id,
        account: deposit.account,
        amount: depositAmounts.get(deposit.id) ?? 0,
        date:
          schedule && isRelativeDate(schedule._date)
            ? toRelativeDay(date, schedule._date)
            : date,
      };
    }),
  });

  // The pay schedule's own occurrences (moved off non-business days), as a
  // zero-day relative date, from a year back to find the last pay date
  const occurrences = getRelativeOccurrences(
    {
      relativeTo: {
        scheduleId: pay.id,
        offset: 0,
        unit: 'days',
        direction: 'after',
      },
    },
    monthUtils.parseDate(monthUtils.addDays(today, -366)),
    monthUtils.parseDate(monthUtils.addDays(today, 366)),
  );
  const next = pay.next_date;
  // Each pay transaction posted after the second-to-last pay date up to today
  // pays one later occurrence: the earliest unpaid one on or after its date,
  // so several paychecks posted early each count once (even after the first
  // pay date passes) and older history can't shift them. Until two pay dates
  // have passed, only transactions within one pay period of the first count,
  // so history linked to a new or re-dated schedule can't hide its skips
  const [first, second] = occurrences;
  const anchor =
    occurrences.filter(o => o <= today).at(-2) ??
    (first && second
      ? monthUtils.addDays(
          first,
          -monthUtils.differenceInCalendarDays(second, first),
        )
      : '');
  const upcoming = occurrences.filter(o => o > anchor);
  const paid = new Set<string>();
  for (const posted of postedDates.filter(d => d > anchor).sort()) {
    const date = upcoming.find(o => o >= posted && !paid.has(o));
    if (date) {
      paid.add(date);
    }
  }
  return {
    netAmount,
    next: atPayDate(next),
    skipped: occurrences.filter(
      date => date > today && date < next && !paid.has(date),
    ),
    later: occurrences
      .filter(date => date > next)
      .slice(0, 3)
      .map(atPayDate),
  };
}
