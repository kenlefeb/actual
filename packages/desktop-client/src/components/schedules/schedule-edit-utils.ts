import { isRelativeDate } from '@actual-app/core/shared/relative-dates';
import { extractScheduleConds } from '@actual-app/core/shared/schedules';
import type {
  RuleConditionEntity,
  RuleConditionOp,
  ScheduleEntity,
} from '@actual-app/core/types/models';
import { t } from 'i18next';

import type { ScheduleFormFields } from './ScheduleEditForm';

export function updateScheduleConditions(
  schedule: Partial<ScheduleEntity>,
  fields: ScheduleFormFields,
): { error?: string; conditions?: RuleConditionEntity[] } {
  const conds = extractScheduleConds(schedule._conditions);

  const updateCond = (
    cond: ReturnType<typeof extractScheduleConds>[keyof ReturnType<
      typeof extractScheduleConds
    >],
    op: RuleConditionOp,
    field: string,
    value: (typeof fields)[keyof typeof fields],
  ) => {
    if (cond) {
      return { ...cond, value };
    }

    if (value != null || field === 'payee') {
      return { op, field, value };
    }

    return null;
  };

  // Validate
  if (fields.date == null) {
    return { error: t('Date is required'), conditions: [] };
  }

  if (isRelativeDate(fields.date) && !fields.date.relativeTo.scheduleId) {
    return {
      error: t('Choose the schedule this date is relative to'),
      conditions: [],
    };
  }

  if (fields.amount == null) {
    return { error: t('A valid amount is required'), conditions: [] };
  }

  return {
    conditions: [
      updateCond(conds.payee, 'is', 'payee', fields.payee),
      updateCond(conds.account, 'is', 'account', fields.account),
      updateCond(conds.date, 'isapprox', 'date', fields.date),
      // We don't use `updateCond` for amount because we want to
      // overwrite it completely
      {
        op: (fields.amountOp || 'isapprox') as RuleConditionOp,
        field: 'amount',
        value: fields.amount,
      },
    ].filter((val): val is RuleConditionEntity => val != null),
  };
}
