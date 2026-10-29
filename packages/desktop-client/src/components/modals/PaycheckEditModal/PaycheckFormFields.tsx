import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { format as monthUtilFormat } from '@actual-app/core/shared/months';
import { MAX_DEPOSIT_DAYS_EARLY } from '@actual-app/core/shared/paychecks';

import { FinancialText } from '#components/FinancialText';
import { Checkbox } from '#components/forms';
import { RecurringSchedulePicker } from '#components/select/RecurringSchedulePicker';
import { AmountInput } from '#components/util/AmountInput';
import { GenericInput } from '#components/util/GenericInput';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';
import type { PaycheckForm } from '#hooks/usePaycheckForm';
import { useTouchTargetStyle } from '#hooks/useTouchTargetStyle';

// The paycheck editor's fields, laid out by the desktop modal and the mobile page

type FormProps = { form: PaycheckForm };

export function PaycheckNameFields({ form }: FormProps) {
  const { t } = useTranslation();
  const touch = useTouchTargetStyle();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 15 }}>
      <Field label={t('Name')} htmlFor="paycheck-name">
        <Input
          style={touch}
          id="paycheck-name"
          value={form.name}
          onChangeValue={form.setName}
        />
      </Field>
      <Field label={t('Employer')}>
        <GenericInput
          style={{ '& input': touch }}
          aria-label={t('Employer')}
          type="id"
          field="payee"
          value={form.definition.payee ?? ''}
          onChange={(payee: string) => form.update({ payee: payee || null })}
        />
      </Field>
    </View>
  );
}

export function PaycheckScheduleFields({ form }: FormProps) {
  const { t } = useTranslation();
  const touch = useTouchTargetStyle();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const { definition, update, nextPayDate } = form;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 15 }}>
      <Field label={t('Clearing account')}>
        {form.paycheck ? (
          <GenericInput
            style={{ '& input': touch }}
            aria-label={t('Clearing account')}
            type="id"
            field="account"
            value={definition.clearingAccount}
            onChange={account => update({ clearingAccount: account })}
          />
        ) : (
          <View style={{ gap: 5 }}>
            <Select
              style={touch}
              aria-label={t('Clearing account')}
              options={[
                ['new', t('New clearing account')],
                ['existing', t('Existing account')],
              ]}
              value={form.isNewAccount ? 'new' : 'existing'}
              onChange={choice => form.setIsNewAccount(choice === 'new')}
            />
            {form.isNewAccount ? (
              <Input
                style={touch}
                aria-label={t('New clearing account name')}
                placeholder={
                  form.clearingName || t('For example, Acme Paycheck')
                }
                value={form.newAccountName}
                onChangeValue={form.setNewAccountName}
              />
            ) : (
              <GenericInput
                style={{ '& input': touch }}
                aria-label={t('Existing clearing account')}
                type="id"
                field="account"
                value={definition.clearingAccount}
                onChange={account => update({ clearingAccount: account })}
              />
            )}
          </View>
        )}
      </Field>
      <Field label={t('Pay dates')}>
        <RecurringSchedulePicker
          value={form.payDates}
          hideSkipWeekend
          onChange={date => update({ date })}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Trans>
            <label htmlFor="paycheck-solve">Move</label>{' '}
            <Select
              style={touch}
              id="paycheck-solve"
              options={[
                ['before', t('before')],
                ['after', t('after')],
              ]}
              value={definition.weekendSolveMode}
              onChange={weekendSolveMode => update({ weekendSolveMode })}
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
  );
}

export function PaycheckGrossFields({ form }: FormProps) {
  const { t } = useTranslation();
  const touch = useTouchTargetStyle();
  const { definition, update } = form;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 15 }}>
      <Field label={t('Gross pay')} htmlFor="paycheck-gross">
        <AmountInput
          inputStyle={touch}
          id="paycheck-gross"
          value={definition.grossAmount}
          sign="+"
          onUpdate={grossAmount => update({ grossAmount })}
        />
      </Field>
      <Field label={t('Income category')}>
        <GenericInput
          style={{ '& input': touch }}
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
  );
}

// On a phone a row's fields stack full width; on wider layouts they share a
// wrapping line
function useRowLayout() {
  const touch = useTouchTargetStyle();
  const isStacked = !!touch.minWidth;
  return {
    touch,
    isStacked,
    row: isStacked
      ? { flexDirection: 'column', alignItems: 'stretch', gap: 8 }
      : {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 5,
          alignItems: 'center',
        },
    fullWidth: isStacked ? { width: '100%', flex: 'none' } : {},
  } as const;
}

export function PaycheckDeductionFields({ form }: FormProps) {
  const { t } = useTranslation();
  const { touch, isStacked, row, fullWidth } = useRowLayout();
  const { updateDeduction } = form;
  return (
    <>
      {form.definition.deductions.map((deduction, index) => (
        <View key={deduction.id} style={row}>
          <Input
            aria-label={t('Deduction {{number}} name', {
              number: index + 1,
            })}
            placeholder={t('Name')}
            value={deduction.name}
            onChangeValue={name => updateDeduction(deduction.id, { name })}
            style={{ flex: 1, ...touch, ...fullWidth }}
          />
          <AmountInput
            aria-label={t('Deduction {{number}} amount', {
              number: index + 1,
            })}
            value={deduction.amount}
            sign="+"
            onUpdate={amount => updateDeduction(deduction.id, { amount })}
            style={{ width: 110, ...fullWidth }}
            inputStyle={touch}
          />
          <Select
            style={{ ...touch, ...fullWidth }}
            aria-label={t('Deduction {{number}} goes to', {
              number: index + 1,
            })}
            options={[
              ['category', t('Category')],
              ['transfer', t('Transfer')],
            ]}
            value={deduction.transferAccount != null ? 'transfer' : 'category'}
            onChange={kind =>
              updateDeduction(deduction.id, {
                transferAccount: kind === 'transfer' ? '' : null,
              })
            }
          />
          <View style={{ flex: 1, gap: 5, ...fullWidth }}>
            {deduction.transferAccount != null && (
              <>
                <Text style={{ color: theme.pageTextSubdued }}>
                  <Trans>Transfer to</Trans>
                </Text>
                <GenericInput
                  style={{ '& input': touch }}
                  aria-label={t('Deduction {{number}} transfer account', {
                    number: index + 1,
                  })}
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
              style={{ '& input': touch }}
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
            style={{ ...touch, ...(isStacked && { alignSelf: 'flex-start' }) }}
            aria-label={t('Remove deduction {{number}}', {
              number: index + 1,
            })}
            onPress={() => form.removeDeduction(deduction.id)}
          >
            <Trans>Remove</Trans>
          </Button>
        </View>
      ))}
      <Button
        style={{ alignSelf: 'flex-start', ...touch }}
        onPress={form.addDeduction}
      >
        <Trans>Add deduction</Trans>
      </Button>
    </>
  );
}

export function PaycheckNetPay({ form }: FormProps) {
  const format = useFormat();
  return (
    <Text>
      <Trans>Net pay:</Trans>{' '}
      <FinancialText>{format(form.netAmount, 'financial')}</FinancialText>
    </Text>
  );
}

export function PaycheckDepositFields({ form }: FormProps) {
  const { t } = useTranslation();
  const { touch, isStacked, row, fullWidth } = useRowLayout();
  const format = useFormat();
  const { accountById, updateDeposit } = form;
  return (
    <>
      {form.definition.deposits.map((deposit, index) => (
        <View key={deposit.id} style={{ gap: 5 }}>
          <View style={row}>
            <View style={{ flex: 1, ...fullWidth }}>
              <GenericInput
                style={{ '& input': touch }}
                aria-label={t('Deposit {{number}} account', {
                  number: index + 1,
                })}
                type="id"
                field="account"
                value={deposit.account}
                onChange={account => updateDeposit(deposit.id, { account })}
              />
            </View>
            <Select
              style={{ ...touch, ...fullWidth }}
              aria-label={t('Deposit {{number}} amount type', {
                number: index + 1,
              })}
              options={[
                ['fixed', t('Fixed amount')],
                ['percent', t('Percent of net pay')],
                ['remainder', t('Remainder')],
              ]}
              value={deposit.kind}
              onChange={kind => updateDeposit(deposit.id, { kind, value: 0 })}
            />
            {deposit.kind === 'fixed' && (
              <AmountInput
                aria-label={t('Deposit {{number}} fixed amount', {
                  number: index + 1,
                })}
                value={deposit.value}
                sign="+"
                onUpdate={value => updateDeposit(deposit.id, { value })}
                style={{ width: 110, ...fullWidth }}
                inputStyle={touch}
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
                style={{ width: 70, ...touch, ...fullWidth }}
              />
            )}
            <FinancialText
              aria-label={t('Deposit {{number}} amount', {
                number: index + 1,
              })}
              style={{ width: 100, textAlign: 'right', ...fullWidth }}
            >
              {format(form.depositAmounts.get(deposit.id) ?? 0, 'financial')}
            </FinancialText>
            <Button
              variant="bare"
              style={{
                ...touch,
                ...(isStacked && { alignSelf: 'flex-start' }),
              }}
              aria-label={t('Remove deposit {{number}}', {
                number: index + 1,
              })}
              onPress={() => form.removeDeposit(deposit.id)}
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
              // On a phone the whole row is the tap target
              ...(isStacked && {
                minHeight: touch.minHeight,
                flexWrap: 'nowrap',
              }),
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
            <label
              htmlFor={`deposit-post-${deposit.id}`}
              style={
                isStacked
                  ? {
                      flexGrow: 1,
                      alignSelf: 'stretch',
                      display: 'flex',
                      alignItems: 'center',
                    }
                  : undefined
              }
            >
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
                  form.daysEarlyInput[deposit.account] ??
                  String(form.savedDaysEarly(deposit.account))
                }
                onChangeValue={value =>
                  form.setDaysEarlyInput(deposit.account, value)
                }
                style={{ width: 60, ...touch }}
              />
              <Text style={{ color: theme.pageTextSubdued }}>
                {t('Calendar: {{calendar}}', {
                  calendar: form.calendarName(deposit.account),
                })}
              </Text>
            </View>
          )}
          {form.changedDaysEarly.some(d => d.account === deposit.account) && (
            <Text role="note" style={{ color: theme.pageTextSubdued }}>
              {t('Applies to every paycheck depositing to {{account}}.', {
                account: accountById.get(deposit.account)?.name,
              })}
            </Text>
          )}
          {deposit.postAutomatically && (
            <Text role="note" style={{ color: theme.pageTextSubdued }}>
              <Trans>
                A bank-synced deposit merges with the posted one only when its
                amount is exactly the same. Leave this off for deposits that
                vary.
              </Trans>
            </Text>
          )}
        </View>
      ))}
      <Button
        style={{ alignSelf: 'flex-start', ...touch }}
        onPress={form.addDeposit}
      >
        <Trans>Add deposit</Trans>
      </Button>
    </>
  );
}

export function PaycheckFormErrors({ form }: FormProps) {
  if (!form.isEdited || form.formErrors.length === 0) return null;
  return (
    <View role="alert" style={{ gap: 3 }}>
      {form.formErrors.map(error => (
        <Text key={error} style={{ color: theme.errorText }}>
          {error}
        </Text>
      ))}
    </View>
  );
}

// Delete and skip for an existing paycheck; close runs once either succeeds
export function PaycheckActions({
  form,
  close,
}: FormProps & { close: () => void }) {
  const { t } = useTranslation();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const { isNarrowWidth } = useResponsive();
  const touch = useTouchTargetStyle();
  if (!form.paycheck) return null;
  // On a phone, Delete looks destructive and sits apart, below Skip
  const deleteButton = (
    <Button
      style={
        isNarrowWidth
          ? {
              ...touch,
              marginTop: 20,
              color: theme.errorText,
              borderColor: theme.errorText,
            }
          : undefined
      }
      onPress={() => form.confirmDelete(close)}
    >
      <Trans>Delete paycheck</Trans>
    </Button>
  );
  return (
    <>
      {!isNarrowWidth && deleteButton}
      {form.isConfirmingSkip ? (
        <>
          <Text>
            {form.nextPayDate
              ? t('Skip the paycheck on {{date}}?', {
                  date: monthUtilFormat(form.nextPayDate, dateFormat),
                })
              : t('Skip the next paycheck?')}
          </Text>
          <Button style={touch} onPress={() => form.setIsConfirmingSkip(false)}>
            <Trans>Keep it</Trans>
          </Button>
          <Button style={touch} onPress={() => form.skipNext(close)}>
            <Trans>Skip it</Trans>
          </Button>
        </>
      ) : (
        <Button
          style={touch}
          isDisabled={form.isEdited}
          onPress={() => form.setIsConfirmingSkip(true)}
        >
          <Trans>Skip next paycheck</Trans>
        </Button>
      )}
      {isNarrowWidth && deleteButton}
    </>
  );
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
