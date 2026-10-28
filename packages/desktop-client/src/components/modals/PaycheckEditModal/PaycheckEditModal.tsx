import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import {
  currentDay,
  format as monthUtilFormat,
} from '@actual-app/core/shared/months';
import {
  computePaycheck,
  MAX_DEPOSIT_DAYS_EARLY,
} from '@actual-app/core/shared/paychecks';
import type { PaycheckError } from '@actual-app/core/shared/paychecks';
import { q } from '@actual-app/core/shared/query';
import type {
  PaycheckDeduction,
  PaycheckDefinition,
  PaycheckDeposit,
  PaycheckEntity,
} from '@actual-app/core/types/models';
import { v4 as uuidv4 } from 'uuid';

import {
  Modal,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { FinancialText } from '#components/FinancialText';
import { Checkbox } from '#components/forms';
import { RecurringSchedulePicker } from '#components/select/RecurringSchedulePicker';
import { AmountInput } from '#components/util/AmountInput';
import { GenericInput } from '#components/util/GenericInput';
import { useAccounts } from '#hooks/useAccounts';
import { useBusinessCalendars } from '#hooks/useBusinessCalendars';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';
import { usePaychecks } from '#hooks/usePaychecks';
import { usePayeesById } from '#hooks/usePayees';
import { useSchedules } from '#hooks/useSchedules';
import { pushModal } from '#modals/modalsSlice';
import {
  useDeletePaycheckMutation,
  useSavePaycheckMutation,
  useSetAccountBusinessDaysMutation,
  useSkipNextPaycheckMutation,
} from '#paychecks';
import { useDispatch } from '#redux';

import { PaycheckYearToDate } from './PaycheckYearToDate';

type PaycheckEditModalProps = {
  paycheckId?: PaycheckEntity['id'];
};

export function PaycheckEditModal({ paycheckId }: PaycheckEditModalProps) {
  const { data: paychecks = [], isPlaceholderData } = usePaychecks();
  const paycheck = paychecks.find(p => p.id === paycheckId);

  // Wait for an existing paycheck before seeding the form with it
  if (paycheckId && (isPlaceholderData || !paycheck)) {
    return null;
  }
  return <PaycheckEditor paycheck={paycheck} />;
}

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

function PaycheckEditor({ paycheck }: { paycheck?: PaycheckEntity }) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const format = useFormat();
  const savePaycheck = useSavePaycheckMutation();
  const deletePaycheck = useDeletePaycheckMutation();
  const skipNext = useSkipNextPaycheckMutation();
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
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  // Memoized by hand: the compiler skips this component, and a new query on
  // every render re-subscribes and re-renders without end
  const paySchedule = paycheck?.definition.paySchedule ?? null;
  const paySchedulesQuery = useMemo(
    () => q('schedules').filter({ id: paySchedule }).select('*'),
    [paySchedule],
  );
  const { schedules: paySchedules } = useSchedules({
    query: paySchedulesQuery,
  });
  const nextPayDate = paySchedules[0]?.next_date;
  const [newAccountName, setNewAccountName] = useState('');
  // Days early typed for deposit accounts, saved to the accounts on save
  const [daysEarlyInput, setDaysEarlyInput] = useState<Record<string, string>>(
    {},
  );

  const { netAmount, depositAmounts, errors } = computePaycheck(definition);
  const accountById = new Map(accounts.map(a => [a.id, a]));
  const clearing = accountById.get(definition.clearingAccount);
  // Shown as moved, the way the pay schedule saves it
  const clearingCalendarId = clearing?.business_calendar_id ?? undefined;
  const payDates = useMemo(
    () => ({
      ...definition.date,
      skipWeekend: true,
      weekendSolveMode: definition.weekendSolveMode,
      businessCalendarId: clearingCalendarId,
    }),
    [definition.date, definition.weekendSolveMode, clearingCalendarId],
  );
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
  const changedDaysEarly = definition.deposits.flatMap(({ account }) => {
    const input = daysEarlyInput[account];
    if (input === undefined || !accountById.has(account)) return [];
    const days = input.trim() === '' ? NaN : Number(input);
    const isValid =
      Number.isInteger(days) && days >= 0 && days <= MAX_DEPOSIT_DAYS_EARLY;
    if (isValid && days === savedDaysEarly(account)) return [];
    return [{ account, days: isValid ? days : null }];
  });
  const formErrors = [
    ...(!name.trim() ? [t('Enter a name for the paycheck.')] : []),
    ...(isNewAccount && !clearingName
      ? [t('Enter a name for the new clearing account.')]
      : []),
    ...(!isNewAccount && !definition.clearingAccount
      ? [t('Choose the clearing account.')]
      : []),
    ...(!isNewAccount && clearing && (clearing.offbudget || clearing.closed)
      ? [t('The clearing account must be an open on-budget account.')]
      : []),
    ...(new Set(definition.deposits.map(d => d.account)).size !==
    definition.deposits.length
      ? [t('Each deposit must go to a different account.')]
      : []),
    ...(definition.deductions.some(d => d.transferAccount === '')
      ? [t('Choose an account for each transfer deduction.')]
      : []),
    ...(definition.deposits.some(d => !d.account)
      ? [t('Choose an account for each deposit.')]
      : []),
    ...(definition.deposits.some(
      d => d.account && d.account === definition.clearingAccount,
    )
      ? [t('A deposit cannot go to the clearing account.')]
      : []),
    ...(changedDaysEarly.some(d => d.days === null)
      ? [
          t('Business days early must be a whole number from 0 to {{max}}.', {
            max: MAX_DEPOSIT_DAYS_EARLY,
          }),
        ]
      : []),
    ...errors.map(error => errorMessage(error, t)),
  ];

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
  const updateDeposit = (id: string, fields: Partial<PaycheckDeposit>) =>
    update({
      deposits: definition.deposits.map(d =>
        d.id === id ? { ...d, ...fields } : d,
      ),
    });

  return (
    <Modal
      name="paycheck-edit"
      containerProps={{ style: { width: '80vw', maxWidth: 900 } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={
              <ModalTitle
                title={paycheck ? t('Edit paycheck') : t('Add paycheck')}
              />
            }
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ gap: 15 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 15 }}>
              <Field label={t('Name')} htmlFor="paycheck-name">
                <Input
                  id="paycheck-name"
                  value={name}
                  onChangeValue={setName}
                />
              </Field>
              <Field label={t('Employer')}>
                <GenericInput
                  aria-label={t('Employer')}
                  type="id"
                  field="payee"
                  value={definition.payee ?? ''}
                  onChange={(payee: string) => update({ payee: payee || null })}
                />
              </Field>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 15 }}>
              <Field label={t('Clearing account')}>
                {paycheck ? (
                  <GenericInput
                    aria-label={t('Clearing account')}
                    type="id"
                    field="account"
                    value={definition.clearingAccount}
                    onChange={account => update({ clearingAccount: account })}
                  />
                ) : (
                  <View style={{ gap: 5 }}>
                    <Select
                      aria-label={t('Clearing account')}
                      options={[
                        ['new', t('New clearing account')],
                        ['existing', t('Existing account')],
                      ]}
                      value={isNewAccount ? 'new' : 'existing'}
                      onChange={choice => setIsNewAccount(choice === 'new')}
                    />
                    {isNewAccount ? (
                      <Input
                        aria-label={t('New clearing account name')}
                        placeholder={
                          clearingName || t('For example, Acme Paycheck')
                        }
                        value={newAccountName}
                        onChangeValue={value => {
                          setIsEdited(true);
                          setNewAccountName(value);
                        }}
                      />
                    ) : (
                      <GenericInput
                        aria-label={t('Existing clearing account')}
                        type="id"
                        field="account"
                        value={definition.clearingAccount}
                        onChange={account =>
                          update({ clearingAccount: account })
                        }
                      />
                    )}
                  </View>
                )}
              </Field>
              <Field label={t('Pay dates')}>
                <RecurringSchedulePicker
                  value={payDates}
                  hideSkipWeekend
                  onChange={date => update({ date })}
                />
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
                >
                  <Trans>
                    <label htmlFor="paycheck-solve">Move</label>{' '}
                    <Select
                      id="paycheck-solve"
                      options={[
                        ['before', t('before')],
                        ['after', t('after')],
                      ]}
                      value={definition.weekendSolveMode}
                      onChange={weekendSolveMode =>
                        update({ weekendSolveMode })
                      }
                    />{' '}
                    <label htmlFor="paycheck-solve">
                      the clearing account's non-business days
                    </label>
                  </Trans>
                </View>
                {/* Upcoming dates above follow the pattern; this one includes skips */}
                {nextPayDate && (
                  <Text style={{ fontWeight: 600 }}>
                    {t('Next paycheck: {{date}}', {
                      date: monthUtilFormat(nextPayDate, dateFormat),
                    })}
                  </Text>
                )}
              </Field>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 15 }}>
              <Field label={t('Gross pay')} htmlFor="paycheck-gross">
                <AmountInput
                  id="paycheck-gross"
                  value={definition.grossAmount}
                  sign="+"
                  onUpdate={grossAmount => update({ grossAmount })}
                />
              </Field>
              <Field label={t('Income category')}>
                <GenericInput
                  aria-label={t('Income category')}
                  type="id"
                  field="category"
                  value={definition.incomeCategory ?? ''}
                  onChange={(category: string) =>
                    update({ incomeCategory: category || null })
                  }
                />
              </Field>
            </View>

            <Section title={t('Deductions')}>
              {definition.deductions.map((deduction, index) => (
                <View
                  key={deduction.id}
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: 5,
                    alignItems: 'center',
                  }}
                >
                  <Input
                    aria-label={t('Deduction {{number}} name', {
                      number: index + 1,
                    })}
                    placeholder={t('Name')}
                    value={deduction.name}
                    onChangeValue={name =>
                      updateDeduction(deduction.id, { name })
                    }
                    style={{ flex: 1 }}
                  />
                  <AmountInput
                    aria-label={t('Deduction {{number}} amount', {
                      number: index + 1,
                    })}
                    value={deduction.amount}
                    sign="+"
                    onUpdate={amount =>
                      updateDeduction(deduction.id, { amount })
                    }
                    style={{ width: 110 }}
                  />
                  <Select
                    aria-label={t('Deduction {{number}} goes to', {
                      number: index + 1,
                    })}
                    options={[
                      ['category', t('Category')],
                      ['transfer', t('Transfer')],
                    ]}
                    value={
                      deduction.transferAccount != null
                        ? 'transfer'
                        : 'category'
                    }
                    onChange={kind =>
                      updateDeduction(deduction.id, {
                        transferAccount: kind === 'transfer' ? '' : null,
                      })
                    }
                  />
                  <View style={{ flex: 1, gap: 5 }}>
                    {deduction.transferAccount != null && (
                      <>
                        <Text style={{ color: theme.pageTextSubdued }}>
                          <Trans>Transfer to</Trans>
                        </Text>
                        <GenericInput
                          aria-label={t(
                            'Deduction {{number}} transfer account',
                            { number: index + 1 },
                          )}
                          type="id"
                          field="account"
                          value={deduction.transferAccount}
                          onChange={transferAccount =>
                            updateDeduction(deduction.id, { transferAccount })
                          }
                        />
                      </>
                    )}
                    <Text style={{ color: theme.pageTextSubdued }}>
                      <Trans>Category</Trans>
                    </Text>
                    <GenericInput
                      aria-label={t('Deduction {{number}} category', {
                        number: index + 1,
                      })}
                      type="id"
                      field="category"
                      value={deduction.category ?? ''}
                      onChange={(category: string) =>
                        updateDeduction(deduction.id, {
                          category: category || null,
                        })
                      }
                    />
                  </View>
                  <Button
                    variant="bare"
                    aria-label={t('Remove deduction {{number}}', {
                      number: index + 1,
                    })}
                    onPress={() =>
                      update({
                        deductions: definition.deductions.filter(
                          d => d.id !== deduction.id,
                        ),
                      })
                    }
                  >
                    <Trans>Remove</Trans>
                  </Button>
                </View>
              ))}
              <Button
                style={{ alignSelf: 'flex-start' }}
                onPress={() =>
                  update({
                    deductions: [
                      ...definition.deductions,
                      { id: uuidv4(), name: '', amount: 0, category: null },
                    ],
                  })
                }
              >
                <Trans>Add deduction</Trans>
              </Button>
            </Section>

            <Text>
              <Trans>Net pay:</Trans>{' '}
              <FinancialText>{format(netAmount, 'financial')}</FinancialText>
            </Text>

            <Section title={t('Direct deposits')}>
              {definition.deposits.map((deposit, index) => (
                <View key={deposit.id} style={{ gap: 5 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      gap: 5,
                      alignItems: 'center',
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <GenericInput
                        aria-label={t('Deposit {{number}} account', {
                          number: index + 1,
                        })}
                        type="id"
                        field="account"
                        value={deposit.account}
                        onChange={account =>
                          updateDeposit(deposit.id, { account })
                        }
                      />
                    </View>
                    <Select
                      aria-label={t('Deposit {{number}} amount type', {
                        number: index + 1,
                      })}
                      options={[
                        ['fixed', t('Fixed amount')],
                        ['percent', t('Percent of net pay')],
                        ['remainder', t('Remainder')],
                      ]}
                      value={deposit.kind}
                      onChange={kind =>
                        updateDeposit(deposit.id, { kind, value: 0 })
                      }
                    />
                    {deposit.kind === 'fixed' && (
                      <AmountInput
                        aria-label={t('Deposit {{number}} fixed amount', {
                          number: index + 1,
                        })}
                        value={deposit.value}
                        sign="+"
                        onUpdate={value => updateDeposit(deposit.id, { value })}
                        style={{ width: 110 }}
                      />
                    )}
                    {deposit.kind === 'percent' && (
                      <Input
                        aria-label={t('Deposit {{number}} percent', {
                          number: index + 1,
                        })}
                        type="number"
                        min={0}
                        max={100}
                        // Uncontrolled so a half-typed "12." keeps its decimal point
                        defaultValue={String(deposit.value)}
                        onChangeValue={value =>
                          updateDeposit(deposit.id, {
                            value: Math.max(0, Number(value) || 0),
                          })
                        }
                        style={{ width: 70 }}
                      />
                    )}
                    <FinancialText
                      aria-label={t('Deposit {{number}} amount', {
                        number: index + 1,
                      })}
                      style={{ width: 100, textAlign: 'right' }}
                    >
                      {format(depositAmounts.get(deposit.id) ?? 0, 'financial')}
                    </FinancialText>
                    <Button
                      variant="bare"
                      aria-label={t('Remove deposit {{number}}', {
                        number: index + 1,
                      })}
                      onPress={() =>
                        update({
                          deposits: definition.deposits.filter(
                            d => d.id !== deposit.id,
                          ),
                        })
                      }
                    >
                      <Trans>Remove</Trans>
                    </Button>
                  </View>
                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      gap: 5,
                      alignItems: 'center',
                    }}
                  >
                    <Checkbox
                      id={`deposit-post-${deposit.id}`}
                      checked={!!deposit.postAutomatically}
                      onChange={e =>
                        updateDeposit(deposit.id, {
                          postAutomatically: e.target.checked,
                        })
                      }
                    />
                    <label htmlFor={`deposit-post-${deposit.id}`}>
                      <Trans>Post automatically</Trans>
                    </label>
                  </View>
                  {accountById.has(deposit.account) && (
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        gap: 5,
                        alignItems: 'center',
                      }}
                    >
                      <label htmlFor={`deposit-days-${deposit.id}`}>
                        <Trans>Business days early</Trans>
                      </label>
                      <Input
                        id={`deposit-days-${deposit.id}`}
                        type="number"
                        min={0}
                        max={MAX_DEPOSIT_DAYS_EARLY}
                        step={1}
                        value={
                          daysEarlyInput[deposit.account] ??
                          String(savedDaysEarly(deposit.account))
                        }
                        onChangeValue={value => {
                          setIsEdited(true);
                          setDaysEarlyInput(current => ({
                            ...current,
                            [deposit.account]: value,
                          }));
                        }}
                        style={{ width: 60 }}
                      />
                      <Text style={{ color: theme.pageTextSubdued }}>
                        {t('Calendar: {{calendar}}', {
                          calendar: calendarName(deposit.account),
                        })}
                      </Text>
                    </View>
                  )}
                  {changedDaysEarly.some(
                    d => d.account === deposit.account,
                  ) && (
                    <Text role="note" style={{ color: theme.pageTextSubdued }}>
                      {t(
                        'Applies to every paycheck depositing to {{account}}.',
                        { account: accountById.get(deposit.account)?.name },
                      )}
                    </Text>
                  )}
                  {deposit.postAutomatically && (
                    <Text role="note" style={{ color: theme.pageTextSubdued }}>
                      <Trans>
                        A bank-synced deposit merges with the posted one only
                        when its amount is exactly the same. Leave this off for
                        deposits that vary.
                      </Trans>
                    </Text>
                  )}
                </View>
              ))}
              <Button
                style={{ alignSelf: 'flex-start' }}
                onPress={() =>
                  update({
                    deposits: [
                      ...definition.deposits,
                      { id: uuidv4(), account: '', kind: 'fixed', value: 0 },
                    ],
                  })
                }
              >
                <Trans>Add deposit</Trans>
              </Button>
            </Section>

            {paycheck && <PaycheckYearToDate paycheckId={paycheck.id} />}

            {isEdited && formErrors.length > 0 && (
              <View role="alert" style={{ gap: 3 }}>
                {formErrors.map(error => (
                  <Text key={error} style={{ color: theme.errorText }}>
                    {error}
                  </Text>
                ))}
              </View>
            )}

            <View
              style={{
                flexDirection: 'row',
                gap: 10,
                justifyContent: 'flex-end',
              }}
            >
              {paycheck && (
                <>
                  <Button
                    onPress={() =>
                      dispatch(
                        pushModal({
                          modal: {
                            name: 'confirm-delete',
                            options: {
                              message: t(
                                'Delete the paycheck "{{name}}" and its schedules? Its clearing account and transactions are kept.',
                                { name: paycheck.name },
                              ),
                              onConfirm: () =>
                                deletePaycheck.mutate(
                                  { id: paycheck.id },
                                  { onSuccess: () => state.close() },
                                ),
                            },
                          },
                        }),
                      )
                    }
                  >
                    <Trans>Delete paycheck</Trans>
                  </Button>
                  {isConfirmingSkip ? (
                    <>
                      <Text>
                        {nextPayDate
                          ? t('Skip the paycheck on {{date}}?', {
                              date: monthUtilFormat(nextPayDate, dateFormat),
                            })
                          : t('Skip the next paycheck?')}
                      </Text>
                      <Button onPress={() => setIsConfirmingSkip(false)}>
                        <Trans>Keep it</Trans>
                      </Button>
                      <Button
                        onPress={() =>
                          skipNext.mutate(
                            { id: paycheck.id },
                            { onSuccess: () => state.close() },
                          )
                        }
                      >
                        <Trans>Skip it</Trans>
                      </Button>
                    </>
                  ) : (
                    <Button
                      isDisabled={isEdited}
                      onPress={() => setIsConfirmingSkip(true)}
                    >
                      <Trans>Skip next paycheck</Trans>
                    </Button>
                  )}
                </>
              )}
              <View style={{ flex: 1 }} />
              <Button onPress={() => state.close()}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                variant="primary"
                isDisabled={formErrors.length > 0}
                onPress={() => save(() => state.close())}
              >
                <Trans>Save</Trans>
              </Button>
            </View>
          </View>
        </>
      )}
    </Modal>
  );
}

function errorMessage(
  error: PaycheckError,
  t: ReturnType<typeof useTranslation>['t'],
) {
  switch (error) {
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
      return error satisfies never;
  }
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ flex: 1, minWidth: 260, gap: 5 }}>
      <label htmlFor={htmlFor} style={{ fontWeight: 600 }}>
        {label}
      </label>
      {children}
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontWeight: 600 }}>{title}</Text>
      {children}
    </View>
  );
}
