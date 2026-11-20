import * as api from '@actual-app/api';
import type {
  RecurConfig,
  RelativeDateConfig,
} from '@actual-app/core/types/models';
import { z } from 'zod';

import { internal } from '#connection';
import { Refusal } from '#refusal';
import { withText } from '#sanitize';

import { findAccount, NOTHING } from './accounts';
import type { RegisterWriteTool } from './shared';
import {
  canonical,
  id,
  loggedWrite,
  requireAmount,
  requireDate,
} from './shared';

type Schedule = Awaited<ReturnType<typeof api.getSchedules>>[number];
type AmountOp = 'is' | 'isapprox' | 'isbetween';
type Amount = number | { num1: number; num2: number };
type DateValue = string | RecurConfig | RelativeDateConfig;

/** What a schedule holds, by the names the tools and the audit log use. */
export type ScheduleFields = {
  name?: string;
  payee_id?: string;
  account_id?: string;
  posts_transaction?: boolean;
  amount_op?: AmountOp;
  amount?: Amount;
  date?: DateValue;
};

/** The fields an update logs and an undo may put back, in the order they are logged. */
export const SCHEDULE_FIELDS = [
  'name',
  'payee_id',
  'account_id',
  'posts_transaction',
  'amount_op',
  'amount',
  'date',
] as const;

const NO_MATCH =
  'Cannot expand schedule date: Failed to find a matching occurrence';
/** The next dates a dry run shows (the default of `get_schedule_next_dates`). */
const DRY_RUN_DATES = 10;

const send = (name: string, payload: unknown) =>
  internal()!.send(name as never, payload as never) as Promise<unknown>;

/** A schedule's value for one of the logged fields, as the logs hold it. */
export function scheduleValue(s: Schedule, field: string): unknown {
  switch (field) {
    case 'name':
      return s.name ?? null;
    case 'payee_id':
      return s.payee ?? null;
    case 'account_id':
      return s.account ?? null;
    case 'posts_transaction':
      return s.posts_transaction;
    case 'amount_op':
      return s.amountOp ?? null;
    case 'amount':
      return s.amount ?? null;
    default:
      return s.date;
  }
}

export const sameValue = (a: unknown, b: unknown) =>
  canonical(a ?? null) === canonical(b ?? null);

const isRelative = (d: unknown): d is RelativeDateConfig =>
  typeof d === 'object' && d !== null && 'relativeTo' in d;

const calendarShape = id.optional();
const recurrenceShape = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().optional(),
  start: z.string(),
  patterns: z
    .array(
      z.object({
        value: z.number().int(),
        type: z.enum(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'day']),
      }),
    )
    .max(100)
    .optional(),
  end_mode: z.enum(['never', 'after_n_occurrences', 'on_date']).optional(),
  end_occurrences: z.number().int().optional(),
  end_date: z.string().optional(),
  skip_weekend: z.boolean().optional(),
  weekend_solve_mode: z.enum(['before', 'after']).optional(),
  business_calendar_id: calendarShape,
});
const relativeShape = z.object({
  schedule_id: id,
  offset: z.number().int(),
  unit: z.enum(['days', 'business-days']),
  direction: z.enum(['before', 'after']),
  business_calendar_id: calendarShape,
  skip_weekend: z.boolean().optional(),
  weekend_solve_mode: z.enum(['before', 'after']).optional(),
});

const amountShape = {
  amount_op: z.enum(['is', 'isapprox', 'isbetween']),
  amount: z.number().int().optional(),
  amount_min: z.number().int().optional(),
  amount_max: z.number().int().optional(),
};
const dateShape = {
  date: z.string().optional(),
  recurrence: recurrenceShape.optional(),
  relative_to: relativeShape.optional(),
};
const DATE_NOTE =
  'Give exactly one date form: `date` (one time, YYYY-MM-DD), `recurrence` (frequency, interval, start, optional patterns such as {value: 15, type: "day"}, end_mode with end_occurrences or end_date, skip_weekend, weekend_solve_mode, business_calendar_id) or `relative_to` (schedule_id, offset, unit, direction, optional business_calendar_id).';
const AMOUNT_NOTE =
  'Amounts are integer cents, negative for money out: amount_op `is` or `isapprox` with `amount`, or `isbetween` with `amount_min` and `amount_max`.';

type DateInput = {
  date?: string;
  recurrence?: z.infer<typeof recurrenceShape>;
  relative_to?: z.infer<typeof relativeShape>;
};

const refuse = (text: string) => new Refusal(`${text} ${NOTHING}`);

async function requireCalendar(calendarId: string | undefined) {
  if (
    calendarId !== undefined &&
    !(await api.getBusinessCalendars()).some(c => c.id === calendarId)
  ) {
    throw refuse(
      'business_calendar_id must be the id of an existing business calendar.',
    );
  }
}

async function recurrenceValue(r: NonNullable<DateInput['recurrence']>) {
  requireDate(r.start);
  if (r.interval !== undefined && r.interval < 1) {
    throw refuse('interval must be at least 1.');
  }
  if (r.end_mode === 'on_date') {
    if (r.end_date === undefined) {
      throw refuse('end_mode on_date needs end_date.');
    }
    requireDate(r.end_date);
    if (r.end_date < r.start) {
      throw refuse('end_date must not be before start.');
    }
  }
  if (
    r.end_mode === 'after_n_occurrences' &&
    !(r.end_occurrences !== undefined && r.end_occurrences >= 1)
  ) {
    throw refuse(
      'end_mode after_n_occurrences needs end_occurrences of 1 or more.',
    );
  }
  await requireCalendar(r.business_calendar_id);
  return {
    frequency: r.frequency,
    start: r.start,
    ...(r.interval === undefined ? {} : { interval: r.interval }),
    ...(r.patterns ? { patterns: r.patterns } : {}),
    ...(r.skip_weekend === undefined ? {} : { skipWeekend: r.skip_weekend }),
    ...(r.end_mode ? { endMode: r.end_mode } : {}),
    ...(r.end_mode === 'after_n_occurrences'
      ? { endOccurrences: r.end_occurrences }
      : {}),
    ...(r.end_mode === 'on_date' ? { endDate: r.end_date } : {}),
    ...(r.weekend_solve_mode ? { weekendSolveMode: r.weekend_solve_mode } : {}),
    ...(r.business_calendar_id
      ? { businessCalendarId: r.business_calendar_id }
      : {}),
  } satisfies RecurConfig;
}

async function relativeValue(
  r: NonNullable<DateInput['relative_to']>,
  all: Schedule[],
  selfId?: string,
) {
  const source = all.find(s => s.id === r.schedule_id);
  if (!source) {
    throw refuse(
      'relative_to.schedule_id must be the id of an existing schedule, never a name.',
    );
  }
  if (r.schedule_id === selfId) {
    throw refuse('A schedule cannot be relative to itself.');
  }
  if (isRelative(source.date)) {
    throw refuse('A schedule cannot be relative to another relative schedule.');
  }
  if (
    selfId &&
    all.some(s => isRelative(s.date) && s.date.relativeTo.scheduleId === selfId)
  ) {
    throw refuse(
      'Other schedules are relative to this one, so it cannot be relative itself.',
    );
  }
  await requireCalendar(r.business_calendar_id);
  return {
    relativeTo: {
      scheduleId: r.schedule_id,
      offset: r.offset,
      unit: r.unit,
      direction: r.direction,
    },
    ...(r.business_calendar_id
      ? { businessCalendarId: r.business_calendar_id }
      : {}),
    ...(r.skip_weekend === undefined ? {} : { skipWeekend: r.skip_weekend }),
    ...(r.weekend_solve_mode ? { weekendSolveMode: r.weekend_solve_mode } : {}),
  } satisfies RelativeDateConfig;
}

/** The engine's own expansion of a date definition: the next dates, or a refusal naming why it is invalid. */
async function nextDates(date: DateValue) {
  try {
    return await api.getScheduleDates(date as never, {
      count: DRY_RUN_DATES,
    });
  } catch (error) {
    const message = String((error as { message?: unknown })?.message);
    if (message.startsWith(NO_MATCH)) return [];
    throw refuse(`The date definition was refused: ${message}.`);
  }
}

/** The one date definition a call gives, validated; undefined when none (an update may give none). */
async function dateValue(
  input: DateInput,
  all: Schedule[],
  selfId?: string,
): Promise<DateValue | undefined> {
  const given = [input.date, input.recurrence, input.relative_to].filter(
    x => x !== undefined,
  ).length;
  if (given > 1 || (given === 0 && !selfId)) {
    throw refuse('Give exactly one of date, recurrence or relative_to.');
  }
  let value: DateValue | undefined;
  if (input.date !== undefined) {
    requireDate(input.date);
    value = input.date;
  } else if (input.recurrence) {
    value = await recurrenceValue(input.recurrence);
  } else if (input.relative_to) {
    value = await relativeValue(input.relative_to, all, selfId);
  }
  if (value !== undefined) await nextDates(value);
  return value;
}

type AmountInput = {
  amount_op?: AmountOp;
  amount?: number;
  amount_min?: number;
  amount_max?: number;
};

/** The operator and amount a call gives, completed from the schedule's current ones on an update. */
function amountValue(input: AmountInput, current?: Schedule) {
  const op = input.amount_op ?? current?.amountOp;
  const cur = current?.amount;
  const curRange = typeof cur === 'object' && cur !== null;
  for (const v of [input.amount, input.amount_min, input.amount_max]) {
    if (v !== undefined) requireAmount(v);
  }
  if (op === 'isbetween') {
    const min = input.amount_min ?? (curRange ? cur.num1 : undefined);
    const max = input.amount_max ?? (curRange ? cur.num2 : undefined);
    if (input.amount !== undefined || min === undefined || max === undefined) {
      throw refuse(
        'amount_op isbetween needs amount_min and amount_max, and no amount.',
      );
    }
    if (min > max) throw refuse('amount_min must not be above amount_max.');
    return { op, amount: { num1: min, num2: max } };
  }
  const single = input.amount ?? (curRange ? undefined : cur);
  if (
    input.amount_min !== undefined ||
    input.amount_max !== undefined ||
    typeof single !== 'number'
  ) {
    throw refuse(
      `amount_op ${op ?? ''} needs amount, and no amount_min or amount_max.`,
    );
  }
  return { op: op as AmountOp, amount: single };
}

const conditions = (f: {
  payee: string | null;
  account: string | null;
  date: DateValue;
  op: AmountOp;
  amount: Amount;
}) => [
  { op: 'is', field: 'payee', value: f.payee },
  ...(f.account === null
    ? []
    : [{ op: 'is', field: 'account', value: f.account }]),
  { op: 'isapprox', field: 'date', value: f.date },
  { op: f.op, field: 'amount', value: f.amount },
];

/**
 * The engine's update, built the way the app's schedule form does: the whole
 * payee, account, date and amount conditions, from the schedule's current
 * values with `f` over them. Shared by the update tool and its undo.
 */
export async function applyScheduleFields(
  scheduleId: string,
  f: ScheduleFields,
  resetNextDate = false,
) {
  const cur = (await api.getSchedules()).find(s => s.id === scheduleId);
  if (!cur) throw refuse('The schedule no longer exists.');
  await send('schedule/update', {
    schedule: {
      id: scheduleId,
      ...(f.name === undefined ? {} : { name: f.name }),
      ...(f.posts_transaction === undefined
        ? {}
        : { posts_transaction: f.posts_transaction }),
    },
    conditions: conditions({
      payee: f.payee_id ?? cur.payee ?? null,
      account: f.account_id ?? cur.account ?? null,
      date: f.date ?? cur.date,
      op: f.amount_op ?? (cur.amountOp as AmountOp),
      amount: f.amount ?? (cur.amount as Amount),
    }),
    resetNextDate,
  });
}

async function paycheckManaging(scheduleId: string) {
  return (await api.getPaychecks()).find(
    p =>
      p.definition.paySchedule === scheduleId ||
      p.definition.deposits.some(d => d.schedule === scheduleId),
  )?.id;
}

/** An existing schedule that no paycheck manages. */
async function requireSchedule(scheduleId: string) {
  const all = await api.getSchedules();
  const found = all.find(s => s.id === scheduleId);
  if (!found) {
    throw refuse(
      'schedule_id must be the id of an existing schedule, never a name.',
    );
  }
  const paycheck = await paycheckManaging(scheduleId);
  if (paycheck) {
    throw refuse(
      `That schedule is managed by paycheck ${paycheck}, which regenerates it; change the paycheck instead.`,
    );
  }
  return { all, found };
}

async function requirePayee(payeeId: string) {
  if (!(await api.getPayees()).some(p => p.id === payeeId)) {
    throw refuse('payee_id must be the id of an existing payee, never a name.');
  }
}

/** `getAccounts` lists open accounts only, so a closed one is unknown here. */
async function requireOpenAccount(accountId: string) {
  findAccount(await api.getAccounts(), accountId);
}

function requireName(raw: string, all: Schedule[], selfId?: string) {
  const name = raw.trim();
  if (!name) throw refuse('name must not be empty.');
  if (all.some(s => s.name === name && s.id !== selfId)) {
    throw refuse('There is already a schedule with that name.');
  }
  return name;
}

/** A schedule that can be skipped or posted: not completed, with an account. */
async function requireRunnable(scheduleId: string) {
  const { found } = await requireSchedule(scheduleId);
  if (found.completed) throw refuse('That schedule is completed.');
  if (!found.account) throw refuse('That schedule has no account.');
  return found;
}

const nextDateOf = async (scheduleId: string) =>
  (await api.getSchedules()).find(s => s.id === scheduleId)?.next_date ?? null;

const transactionIds = async (scheduleId: string) =>
  (
    (await api.runQuery(
      api.q('transactions').filter({ schedule: scheduleId }).select(['id']),
    )) as { data: Array<{ id: string }> }
  ).data.map(r => r.id);

export function registerScheduleWriteTools(tool: RegisterWriteTool) {
  tool(
    'write_create_schedule',
    `Create a schedule, as the app's schedule form does, by payee and account id (never names). ${AMOUNT_NOTE} ${DATE_NOTE} \`posts_transaction\` (auto-post) defaults to false. \`dry_run\` returns the changes and the next dates and writes nothing. Returns the new schedule id and next date.`,
    {
      name: z.string(),
      payee_id: id,
      account_id: id,
      posts_transaction: z.boolean().optional(),
      ...amountShape,
      ...dateShape,
      dry_run: z.boolean().optional(),
    },
    async (a, auditLog) => {
      const all = await api.getSchedules();
      const name = requireName(a.name, all);
      await requirePayee(a.payee_id);
      await requireOpenAccount(a.account_id);
      const amount = amountValue(a);
      const date = (await dateValue(a, all))!;
      const posts = a.posts_transaction ?? false;
      const values: Required<ScheduleFields> = {
        name,
        payee_id: a.payee_id,
        account_id: a.account_id,
        posts_transaction: posts,
        amount_op: amount.op,
        amount: amount.amount,
        date,
      };
      const changes = SCHEDULE_FIELDS.map(field => ({
        id: 'new',
        field,
        before: null,
        after: values[field],
      }));
      if (a.dry_run) {
        return withText(
          { dry_run: true, next_dates: await nextDates(date) },
          { changes },
        );
      }
      let created = '';
      return loggedWrite(
        auditLog,
        'write_create_schedule',
        { ids: [a.account_id, a.payee_id], changes },
        async () => {
          created = (await send('schedule/create', {
            schedule: { name, posts_transaction: posts },
            conditions: conditions({
              payee: a.payee_id,
              account: a.account_id,
              date,
              op: amount.op,
              amount: amount.amount,
            }),
          })) as string;
          return { applied: [created], created: [created] };
        },
        async () =>
          withText(
            {
              schedule_id: created,
              next_date: await nextDateOf(created),
              posts_transaction: posts,
            },
            { name },
          ),
      );
    },
    { scopes: ['schedules:write'] },
  );

  tool(
    'write_update_schedule',
    `Change a schedule's fields, as the app's schedule form does, by schedule id (never a name; payee and account by id). Give any of name, payee_id, account_id, posts_transaction, an amount (${AMOUNT_NOTE}), one date form (${DATE_NOTE}) and reset_next_date. A schedule a paycheck manages is refused. \`dry_run\` returns the changes and the next dates and writes nothing. Returns each changed field before and after and the next date before and after.`,
    {
      schedule_id: id,
      name: z.string().optional(),
      payee_id: id.optional(),
      account_id: id.optional(),
      posts_transaction: z.boolean().optional(),
      ...amountShape,
      amount_op: amountShape.amount_op.optional(),
      ...dateShape,
      reset_next_date: z.boolean().optional(),
      dry_run: z.boolean().optional(),
    },
    async (a, auditLog) => {
      const { all, found: cur } = await requireSchedule(a.schedule_id);
      const touchesAmount = [
        a.amount_op,
        a.amount,
        a.amount_min,
        a.amount_max,
      ].some(v => v !== undefined);
      const touchesDate = [a.date, a.recurrence, a.relative_to].some(
        v => v !== undefined,
      );
      const given =
        touchesAmount ||
        touchesDate ||
        [a.name, a.payee_id, a.account_id, a.posts_transaction].some(
          v => v !== undefined,
        ) ||
        a.reset_next_date;
      if (!given) throw refuse('Give at least one field to change.');
      if (a.name !== undefined) requireName(a.name, all, cur.id);
      if (a.payee_id !== undefined) await requirePayee(a.payee_id);
      if (a.account_id !== undefined) await requireOpenAccount(a.account_id);
      const amount = touchesAmount ? amountValue(a, cur) : undefined;
      const date = touchesDate ? await dateValue(a, all, cur.id) : undefined;

      const next: ScheduleFields = {
        ...(a.name === undefined ? {} : { name: a.name.trim() }),
        ...(a.payee_id === undefined ? {} : { payee_id: a.payee_id }),
        ...(a.account_id === undefined ? {} : { account_id: a.account_id }),
        ...(a.posts_transaction === undefined
          ? {}
          : { posts_transaction: a.posts_transaction }),
        ...(amount ? { amount_op: amount.op, amount: amount.amount } : {}),
        ...(date === undefined ? {} : { date }),
      };
      const changes = SCHEDULE_FIELDS.flatMap(field => {
        const after = next[field];
        const before = scheduleValue(cur, field);
        return after !== undefined && !sameValue(before, after)
          ? [{ id: cur.id, field, before, after }]
          : [];
      });
      if (a.reset_next_date) {
        changes.push({
          id: cur.id,
          field: 'next_date' as never,
          before: cur.next_date as never,
          after: 'reset' as never,
        });
      }
      if (changes.length === 0) throw refuse('Nothing to change.');
      const effective = next.date ?? cur.date;
      if (a.dry_run) {
        return withText(
          { dry_run: true, next_dates: await nextDates(effective) },
          { changes },
        );
      }
      return loggedWrite(
        auditLog,
        'write_update_schedule',
        { ids: [cur.id], changes },
        async () => {
          await applyScheduleFields(cur.id, next, a.reset_next_date);
          return { applied: [cur.id] };
        },
        async () =>
          withText(
            {
              schedule_id: cur.id,
              next_date: {
                before: cur.next_date,
                after: await nextDateOf(cur.id),
              },
            },
            {
              changes: changes.map(({ field, before, after }) => ({
                field,
                before,
                after,
              })),
            },
          ),
      );
    },
    { scopes: ['schedules:write'] },
  );

  tool(
    'write_skip_schedule_date',
    'Skip a schedule\'s next date, as the app\'s "Skip next date" does, by schedule id (never a name). A completed schedule, one with no account and one a paycheck manages are refused. Returns the next date before and after.',
    { schedule_id: id },
    async ({ schedule_id }, auditLog) => {
      const cur = await requireRunnable(schedule_id);
      return loggedWrite(
        auditLog,
        'write_skip_schedule_date',
        {
          ids: [schedule_id],
          changes: [
            {
              id: schedule_id,
              field: 'next_date',
              before: cur.next_date,
              after: 'skipped',
            },
          ],
        },
        async () => {
          await api.skipScheduleNextDate(schedule_id);
          return { applied: [schedule_id] };
        },
        async () => ({
          schedule_id,
          next_date: {
            before: cur.next_date,
            after: await nextDateOf(schedule_id),
          },
        }),
      );
    },
    { scopes: ['schedules:write'] },
  );

  tool(
    'write_post_schedule_transaction',
    'Post a schedule\'s transaction, as the app\'s "Post transaction" does, by schedule id (never a name): a transaction dated the next date, or today with `today` true, linked to the schedule, for its account, payee and amount. A completed schedule, one with no account and one a paycheck manages are refused. Returns the new transaction id.',
    { schedule_id: id, today: z.boolean().optional() },
    async ({ schedule_id, today = false }, auditLog) => {
      const cur = await requireRunnable(schedule_id);
      const before = new Set(await transactionIds(schedule_id));
      return loggedWrite(
        auditLog,
        'write_post_schedule_transaction',
        {
          ids: [schedule_id],
          changes: [
            {
              id: schedule_id,
              field: 'transaction',
              before: null,
              after: today ? 'today' : cur.next_date,
            },
          ],
        },
        async () => {
          await api.postScheduleTransaction(schedule_id, today);
          const added = (await transactionIds(schedule_id)).filter(
            t => !before.has(t),
          );
          return { applied: [schedule_id], created: added };
        },
        async o => ({ schedule_id, transaction_ids: o.created ?? [] }),
      );
    },
    { scopes: ['schedules:write', 'transactions:write'] },
  );
}
