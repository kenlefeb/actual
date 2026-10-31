import * as dateFns from 'date-fns';

import type { RelativeDateConfig, RuleConditionOp } from '#types/models';

import { RuleError } from './errors';
import { isValidOp } from './rules';
import { parseRecurSchedule } from './schedules';

// The parsed value of a rule's `date` condition. The rule `Condition` class and
// the schedule code both read it; it lives here so shared code never has to
// import server code.
export type ParsedDateCondition =
  | { type: 'date' | 'month' | 'year'; date: string }
  | { type: 'recur'; schedule: ReturnType<typeof parseRecurSchedule> }
  | { type: 'relative'; config: RelativeDateConfig };

function assert(test: unknown, type: string, msg: string): asserts test {
  if (!test) {
    throw new RuleError(type, msg);
  }
}

export function parseRecurDate(desc: Parameters<typeof parseRecurSchedule>[0]) {
  try {
    return { type: 'recur' as const, schedule: parseRecurSchedule(desc) };
  } catch (e) {
    throw new RuleError('parse-recur-date', (e as Error).message);
  }
}

export function parseDateString(
  str: unknown,
): { type: 'date' | 'month' | 'year'; date: string } | null {
  if (typeof str !== 'string') {
    return null;
  } else if (str.length === 10) {
    // YYYY-MM-DD
    if (!dateFns.isValid(dateFns.parseISO(str))) {
      return null;
    }

    return { type: 'date', date: str };
  } else if (str.length === 7) {
    // YYYY-MM
    if (!dateFns.isValid(dateFns.parseISO(str + '-01'))) {
      return null;
    }

    return { type: 'month', date: str };
  } else if (str.length === 4) {
    // YYYY
    if (!dateFns.isValid(dateFns.parseISO(str + '-01-01'))) {
      return null;
    }

    return { type: 'year', date: str };
  }

  return null;
}

// Parses the value of a `date` condition and checks it suits the operator.
// Throws a RuleError for a value the condition cannot hold.
export function parseDateConditionValue(
  op: RuleConditionOp,
  value: unknown,
  fieldName: string,
): ParsedDateCondition {
  const object =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null;
  const parsed: ParsedDateCondition | null =
    typeof value === 'string'
      ? parseDateString(value)
      : object?.relativeTo != null
        ? { type: 'relative', config: object as unknown as RelativeDateConfig }
        : object?.frequency != null
          ? parseRecurDate(object as Parameters<typeof parseRecurDate>[0])
          : null;
  assert(parsed, 'date-format', `Invalid date format (field: ${fieldName})`);

  // Approximate only works with exact, recurring & relative dates
  if (op === 'isapprox') {
    assert(
      parsed.type === 'date' ||
        parsed.type === 'recur' ||
        parsed.type === 'relative',
      'date-format',
      `Invalid date value for "isapprox" (field: ${fieldName})`,
    );
  }
  // These only work with exact dates
  else if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
    assert(
      parsed.type === 'date',
      'date-format',
      `Invalid date value for "${op}" (field: ${fieldName})`,
    );
  }

  return parsed;
}

// What `new Condition(op, 'date', value, null).getValue()` returns, with the
// same checks and errors, without the server-side class.
export function parseDateCondition(
  op: RuleConditionOp,
  value: unknown,
): ParsedDateCondition {
  assert(
    isValidOp('date', op),
    'internal',
    `Invalid condition operator: ${op} (type: date, field: date)`,
  );
  assert(value != null, 'no-null', 'Field cannot be empty: date');
  return parseDateConditionValue(op, value, 'date');
}
