import type { AccountEntity } from './account';
import type { CategoryEntity } from './category';
import type { PayeeEntity } from './payee';
import type { RecurConfig, ScheduleEntity } from './schedule';

export type PaycheckDeduction = {
  id: string;
  name: string;
  // Positive amount in cents, subtracted from gross pay
  amount: number;
  // Either a category or a transfer to another account (e.g. a 401(k))
  category?: CategoryEntity['id'] | null;
  transferAccount?: AccountEntity['id'] | null;
};

export type PaycheckDepositKind = 'fixed' | 'percent' | 'remainder';

export type PaycheckDeposit = {
  id: string;
  account: AccountEntity['id'];
  kind: PaycheckDepositKind;
  // Cents for fixed deposits, a percent of net pay for percent deposits,
  // ignored for the remainder
  value: number;
  postAutomatically?: boolean;
  // The generated deposit schedule
  schedule?: ScheduleEntity['id'] | null;
};

export type PaycheckDefinition = {
  payee: PayeeEntity['id'] | null;
  clearingAccount: AccountEntity['id'];
  // Pay dates; the calendar comes from the clearing account
  date: RecurConfig;
  weekendSolveMode: 'before' | 'after';
  // Positive amount in cents
  grossAmount: number;
  incomeCategory: CategoryEntity['id'] | null;
  deductions: PaycheckDeduction[];
  deposits: PaycheckDeposit[];
  // The generated pay schedule
  paySchedule?: ScheduleEntity['id'] | null;
};

export type PaycheckEntity = {
  id: string;
  name: string;
  definition: PaycheckDefinition;
};

// Totals of a paycheck's posted pay transactions in one calendar year
export type PaycheckYearToDate = {
  year: number;
  gross: number;
  // Positive totals, by the deduction split's notes
  deductions: { name: string; amount: number }[];
  net: number;
};

// A clearing account after its paycheck's latest posted pay date
export type PaycheckClearingStatus = {
  paycheck: PaycheckEntity['id'];
  clearingAccount: AccountEntity['id'];
  balance: number;
  // Null before the first pay transaction posts
  payDate: string | null;
  // Deposits for that pay date with no linked transaction yet
  missingDeposits: {
    id: PaycheckDeposit['id'];
    account: AccountEntity['id'];
    expectedDate: string;
  }[];
  // The balance should be zero by now and isn't
  isWarning: boolean;
};
