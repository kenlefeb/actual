import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { currentDay } from '@actual-app/core/shared/months';
import {
  changedDepositDaysEarly,
  computePaycheck,
  MAX_DEPOSIT_DAYS_EARLY,
  validatePaycheckDraft,
} from '@actual-app/core/shared/paychecks';
import type { PaycheckDraftErrorCode } from '@actual-app/core/shared/paychecks';
import { q } from '@actual-app/core/shared/query';
import type {
  PaycheckDeduction,
  PaycheckDefinition,
  PaycheckDeposit,
  PaycheckEntity,
} from '@actual-app/core/types/models';
import { v4 as uuidv4 } from 'uuid';

import { useAccounts } from '#hooks/useAccounts';
import { useBusinessCalendars } from '#hooks/useBusinessCalendars';
import { useConfirmDelete } from '#hooks/useConfirmDelete';
import { usePayeesById } from '#hooks/usePayees';
import { useSchedules } from '#hooks/useSchedules';
import {
  useDeletePaycheckMutation,
  useSavePaycheckMutation,
  useSetAccountBusinessDaysMutation,
  useSkipNextPaycheckMutation,
} from '#paychecks';

export type PaycheckForm = ReturnType<typeof usePaycheckForm>;

function newDefinition(): PaycheckDefinition {
  return {
    payee: null,
    clearingAccount: '',
    date: {
      start: currentDay(),
      frequency: 'monthly',
      interval: 1,
      patterns: [
        { type: 'day', value: 15 },
        { type: 'day', value: -1 },
      ],
      endMode: 'never',
    },
    weekendSolveMode: 'before',
    grossAmount: 0,
    incomeCategory: null,
    deductions: [],
    deposits: [{ id: uuidv4(), account: '', kind: 'remainder', value: 0 }],
  };
}

// The paycheck editor's form state, validation and computed amounts, shared
// by the desktop modal and the mobile page
export function usePaycheckForm(paycheck?: PaycheckEntity) {
  const { t } = useTranslation();
  const askToDelete = useConfirmDelete();
  const savePaycheck = useSavePaycheckMutation();
  const deletePaycheck = useDeletePaycheckMutation();
  const skipNextPaycheck = useSkipNextPaycheckMutation();
  const setBusinessDays = useSetAccountBusinessDaysMutation();

  const { data: accounts = [] } = useAccounts();
  const { data: calendars = [] } = useBusinessCalendars();
  const { data: payeesById = {} } = usePayeesById();

  const [name, setNameValue] = useState(paycheck?.name ?? '');
  const [definition, setDefinition] = useState<PaycheckDefinition>(
    paycheck?.definition ?? newDefinition,
  );
  // Errors show and skipping waits once the user has changed something
  const [isEdited, setIsEdited] = useState(false);
  const setName = (value: string) => {
    setIsEdited(true);
    setNameValue(value);
  };
  // A new paycheck creates an on-budget clearing account unless the user
  // picks an existing one
  const [isNewAccount, setIsNewAccount] = useState(!paycheck);
  const [isConfirmingSkip, setIsConfirmingSkip] = useState(false);
  // Memoized by hand: the compiler skips the editor, and a new query on
  // every render re-subscribes and re-renders without end
  const paySchedule = paycheck?.definition.paySchedule ?? null;
  const paySchedulesQuery = useMemo(
    () => q('schedules').filter({ id: paySchedule }).select('*'),
    [paySchedule],
  );
  const { schedules: paySchedules } = useSchedules({
    query: paySchedulesQuery,
  });
  const nextPayDate: string | undefined = paySchedules[0]?.next_date;
  const [newAccountName, setNewAccountNameValue] = useState('');
  const setNewAccountName = (value: string) => {
    setIsEdited(true);
    setNewAccountNameValue(value);
  };
  // Days early typed for deposit accounts, saved to the accounts on save
  const [daysEarlyInput, setDaysEarlyInputs] = useState<Record<string, string>>(
    {},
  );
  const setDaysEarlyInput = (account: string, value: string) => {
    setIsEdited(true);
    setDaysEarlyInputs(current => ({ ...current, [account]: value }));
  };

  const { netAmount, depositAmounts } = computePaycheck(definition);
  const accountById = new Map(accounts.map(a => [a.id, a]));
  const clearing = accountById.get(definition.clearingAccount);
  // Shown as moved, the way the pay schedule saves it
  const clearingCalendarId = clearing?.business_calendar_id ?? undefined;
  const payDates = {
    ...definition.date,
    skipWeekend: true,
    weekendSolveMode: definition.weekendSolveMode,
    businessCalendarId: clearingCalendarId,
  };
  const employerName = definition.payee
    ? payeesById[definition.payee]?.name
    : undefined;
  // A new clearing account is named after the employer unless renamed
  const clearingName =
    newAccountName.trim() ||
    (employerName
      ? t('{{employer}} Paycheck', { employer: employerName })
      : '');
  const calendarName = (accountId: string) =>
    calendars.find(
      c => c.id === accountById.get(accountId)?.business_calendar_id,
    )?.name ?? t('weekends only');
  const savedDaysEarly = (accountId: string) =>
    accountById.get(accountId)?.deposit_days_early ?? 0;
  // Changed values for accounts still deposited to; null when not a valid number
  const changedDaysEarly = changedDepositDaysEarly(
    definition.deposits,
    daysEarlyInput,
    new Map(accounts.map(a => [a.id, a.deposit_days_early ?? 0])),
  );
  const formErrors = validatePaycheckDraft({
    name,
    definition,
    isNewAccount,
    clearingName,
    clearing,
    changedDaysEarly,
  }).map(({ code }) => paycheckErrorMessage(code, t));

  const save = async (close: () => void) => {
    try {
      await savePaycheck.mutateAsync({
        id: paycheck?.id,
        name: name.trim(),
        definition: isNewAccount
          ? { ...definition, clearingAccount: '' }
          : definition,
        newClearingAccountName: isNewAccount ? clearingName : undefined,
      });
      // After the paycheck, so a rejected paycheck leaves accounts unchanged;
      // each account change rewrites every paycheck depositing to it
      for (const { account, days } of changedDaysEarly) {
        await setBusinessDays.mutateAsync({
          id: account,
          businessCalendarId:
            accountById.get(account)?.business_calendar_id ?? null,
          depositDaysEarly: days ?? 0,
        });
      }
      close();
    } catch {
      // The mutation has already shown the error
    }
  };

  const confirmDelete = (close: () => void) => {
    if (!paycheck) return;
    askToDelete({
      title: t('Delete paycheck'),
      message: t(
        'Delete the paycheck "{{name}}" and its schedules? Its clearing account and transactions are kept.',
        { name: paycheck.name },
      ),
      onConfirm: () =>
        deletePaycheck.mutate({ id: paycheck.id }, { onSuccess: close }),
    });
  };

  const skipNext = (close: () => void) => {
    if (!paycheck) return;
    skipNextPaycheck.mutate({ id: paycheck.id }, { onSuccess: close });
  };

  const update = (fields: Partial<PaycheckDefinition>) => {
    setIsEdited(true);
    setDefinition(current => ({ ...current, ...fields }));
  };
  const updateDeduction = (id: string, fields: Partial<PaycheckDeduction>) =>
    update({
      deductions: definition.deductions.map(d =>
        d.id === id ? { ...d, ...fields } : d,
      ),
    });
  const removeDeduction = (id: string) =>
    update({ deductions: definition.deductions.filter(d => d.id !== id) });
  const addDeduction = () =>
    update({
      deductions: [
        ...definition.deductions,
        { id: uuidv4(), name: '', amount: 0, category: null },
      ],
    });
  const updateDeposit = (id: string, fields: Partial<PaycheckDeposit>) =>
    update({
      deposits: definition.deposits.map(d =>
        d.id === id ? { ...d, ...fields } : d,
      ),
    });
  const removeDeposit = (id: string) =>
    update({ deposits: definition.deposits.filter(d => d.id !== id) });
  const addDeposit = () =>
    update({
      deposits: [
        ...definition.deposits,
        { id: uuidv4(), account: '', kind: 'fixed', value: 0 },
      ],
    });

  return {
    paycheck,
    name,
    setName,
    definition,
    update,
    updateDeduction,
    removeDeduction,
    addDeduction,
    updateDeposit,
    removeDeposit,
    addDeposit,
    isEdited,
    isNewAccount,
    setIsNewAccount,
    newAccountName,
    setNewAccountName,
    clearingName,
    employerName,
    accountById,
    payDates,
    nextPayDate,
    netAmount,
    depositAmounts,
    daysEarlyInput,
    setDaysEarlyInput,
    savedDaysEarly,
    changedDaysEarly,
    calendarName,
    formErrors,
    isConfirmingSkip,
    setIsConfirmingSkip,
    save,
    confirmDelete,
    skipNext,
  };
}

// The web's message for each draft error code. The native editor shows the
// same text from the fixture src/data/paycheck-error-messages.json, which a
// test checks against this.
export function paycheckErrorMessage(
  code: PaycheckDraftErrorCode,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  switch (code) {
    case 'name-missing':
      return t('Enter a name for the paycheck.');
    case 'clearing-name-missing':
      return t('Enter a name for the new clearing account.');
    case 'clearing-account-missing':
      return t('Choose the clearing account.');
    case 'clearing-account-not-open-on-budget':
      return t('The clearing account must be an open on-budget account.');
    case 'duplicate-deposit-account':
      return t('Each deposit must go to a different account.');
    case 'transfer-account-missing':
      return t('Choose an account for each transfer deduction.');
    case 'deposit-account-missing':
      return t('Choose an account for each deposit.');
    case 'deposit-to-clearing-account':
      return t('A deposit cannot go to the clearing account.');
    case 'days-early-invalid':
      return t(
        'Business days early must be a whole number from 0 to {{max}}.',
        {
          max: MAX_DEPOSIT_DAYS_EARLY,
        },
      );
    case 'deductions-exceed-gross':
      return t('Deductions exceed gross pay.');
    case 'deposits-exceed-net':
      return t('Deposits exceed net pay.');
    case 'percents-exceed-100':
      return t('Percent deposits total more than 100%.');
    case 'multiple-remainders':
      return t('Only one deposit can be the remainder.');
    case 'deposits-do-not-add-up':
      return t('Deposits must add up to net pay or include a remainder.');
    case 'no-deposits':
      return t('Add at least one direct deposit.');
    default:
      return code satisfies never;
  }
}
