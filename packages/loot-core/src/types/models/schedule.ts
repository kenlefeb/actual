import type { AccountEntity } from './account';
import type { PayeeEntity } from './payee';
import type { RuleActionEntity, RuleConditionEntity, RuleEntity } from './rule';

export type RecurPattern = {
  value: number;
  type: 'SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'day';
};

export type RecurConfig = {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  patterns?: RecurPattern[];
  skipWeekend?: boolean;
  start: string;
  endMode?: 'never' | 'after_n_occurrences' | 'on_date';
  endOccurrences?: number;
  endDate?: string;
  weekendSolveMode?: 'before' | 'after';
  // When set with skipWeekend, skip this business calendar's non-business days
  businessCalendarId?: string;
};

/** A date taken from another schedule's occurrences, offset by an amount. */
export type RelativeDateConfig = {
  relativeTo: {
    scheduleId: string;
    offset: number;
    unit: 'days' | 'business-days';
    direction: 'before' | 'after';
  };
  // Counts business days in this calendar; also used by the move below
  businessCalendarId?: string;
  // Optional final move off non-business days, as for repeating dates
  skipWeekend?: boolean;
  weekendSolveMode?: 'before' | 'after';
};

export type ScheduleEntity = {
  id: string;
  name?: string;
  rule: RuleEntity['id'];
  next_date: string;
  completed: boolean;
  posts_transaction: boolean;
  custom_upcoming_length?: string | null;
  tombstone: boolean;
  sort_order?: number;

  // These are special fields that are actually pulled from the
  // underlying rule
  _payee: PayeeEntity['id'];
  _account: AccountEntity['id'];
  _amount: number | { num1: number; num2: number };
  _amountOp: string;
  _date: RecurConfig | RelativeDateConfig | string;
  _conditions: RuleConditionEntity[];
  _actions: RuleActionEntity[];
  _has_splits?: boolean;
};

export type DiscoverScheduleEntity = {
  id: ScheduleEntity['id'];
  account: AccountEntity['id'];
  payee: PayeeEntity['id'];
  date: RecurConfig;
  amount: ScheduleEntity['_amount'];
  _conditions: ScheduleEntity['_conditions'];
};
