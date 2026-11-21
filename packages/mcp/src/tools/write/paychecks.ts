import { randomUUID } from 'crypto';

import * as api from '@actual-app/api';
import type {
  PaycheckDefinition,
  PaycheckEntity,
} from '@actual-app/core/types/models';
import { z } from 'zod';

import type { Limits } from '#limits';
import { rowLimit } from '#limits';
import { Refusal } from '#refusal';
import { withText } from '#sanitize';

import { findAccount, NOTHING } from './accounts';
import {
  recurrenceShape,
  recurrenceValue,
  refuse,
  requireEngine,
} from './schedules';
import type { RegisterWriteTool } from './shared';
import { confirm, id, loggedWrite, requireAmount } from './shared';

const payRecurrence = recurrenceShape.omit({
  skip_weekend: true,
  weekend_solve_mode: true,
  business_calendar_id: true,
});
const deductionShape = z.object({
  name: z.string().min(1).max(200),
  amount: z.number().int(),
  category_id: id.nullish(),
  transfer_account_id: id.nullish(),
});
const depositShape = z.object({
  account_id: id,
  kind: z.enum(['fixed', 'percent', 'remainder']),
  value: z.number().optional(),
  post_automatically: z.boolean().optional(),
});

/** A stored paycheck by the names the tools use, so a delete's dry run can feed a create. */
function definitionOf(p: PaycheckEntity) {
  const d = p.definition;
  const { frequency, interval, start, patterns, endMode } = d.date;
  return {
    name: p.name,
    payee_id: d.payee,
    clearing_account_id: d.clearingAccount,
    recurrence: {
      frequency,
      ...(interval === undefined ? {} : { interval }),
      start,
      ...(patterns ? { patterns } : {}),
      ...(endMode ? { end_mode: endMode } : {}),
      ...(d.date.endOccurrences === undefined
        ? {}
        : { end_occurrences: d.date.endOccurrences }),
      ...(d.date.endDate === undefined ? {} : { end_date: d.date.endDate }),
    },
    weekend_solve_mode: d.weekendSolveMode,
    gross_amount: d.grossAmount,
    income_category_id: d.incomeCategory,
    deductions: d.deductions.map(x => ({
      name: x.name,
      amount: x.amount,
      category_id: x.category ?? null,
      transfer_account_id: x.transferAccount ?? null,
    })),
    deposits: d.deposits.map(x => ({
      account_id: x.account,
      kind: x.kind,
      value: x.value,
      post_automatically: !!x.postAutomatically,
    })),
  };
}

/** A paycheck's definition without the ids the engine generated, as an undo compares it. */
export function inputDefinition(d: PaycheckDefinition) {
  const { paySchedule: _, ...rest } = d;
  return {
    ...rest,
    deposits: d.deposits.map(({ schedule: _s, ...x }) => x),
  };
}

async function nextDate(scheduleId: string | null | undefined) {
  if (!scheduleId) return null;
  const { data } = (await api.runQuery(
    api.q('schedules').filter({ id: scheduleId }).select(['next_date']),
  )) as { data: Array<{ next_date: string | null }> };
  return data[0]?.next_date ?? null;
}

export function registerPaycheckWriteTools(
  tool: RegisterWriteTool,
  limits: Limits,
) {
  tool(
    'write_skip_paycheck',
    "Skip a paycheck's next pay date (its pay and deposit schedules), by paycheck id (never a name). Returns the next pay date before and after.",
    { paycheck_id: id },
    async ({ paycheck_id }, auditLog) => {
      const paycheck = (await api.getPaychecks()).find(
        p => p.id === paycheck_id,
      );
      if (!paycheck) {
        throw new Refusal(
          'paycheck_id must be the id of an existing paycheck, never a name.',
        );
      }
      const schedule = paycheck.definition.paySchedule;
      const before = await nextDate(schedule);

      return loggedWrite(
        auditLog,
        'write_skip_paycheck',
        {
          ids: [paycheck_id],
          changes: [
            { id: paycheck_id, field: 'next_date', before, after: 'skipped' },
          ],
        },
        async () => {
          await api.skipNextPaycheck(paycheck_id);
          return { applied: [paycheck_id] };
        },
        async () => ({
          paycheck_id,
          next_date: { before, after: await nextDate(schedule) },
        }),
      );
    },
    { scopes: ['schedules:write'] },
  );

  tool(
    'write_create_paycheck',
    `Create a paycheck and the pay and deposit schedules it manages, as the app's paycheck form does. Everything is by id (never names): an existing open on-budget \`clearing_account_id\` (the app can also create one inline; here use write_create_account first), optional \`payee_id\` and \`income_category_id\`, \`deductions\` (name, amount in positive cents, optional category_id or transfer_account_id) and \`deposits\` (account_id, kind fixed, percent or remainder, value in cents or percent, post_automatically). Pay dates are a \`recurrence\` (frequency, interval, start, patterns such as {value: 15, type: "day"}, end_mode with end_occurrences or end_date); weekends move per \`weekend_solve_mode\` (before or after, default before) and the clearing account's business calendar. It does not change any account's business calendar or days early (write_set_account_business_days does). Deductions and deposits together are at most ${limits.maxRows} by default. Returns the paycheck id and its schedule ids. Undo of a paycheck create cannot see a pay posted by hand (deleting a paycheck never deletes posted transactions).`,
    {
      name: z.string(),
      payee_id: id.nullish(),
      clearing_account_id: id,
      recurrence: payRecurrence,
      weekend_solve_mode: z.enum(['before', 'after']).optional(),
      gross_amount: z.number().int(),
      income_category_id: id.nullish(),
      deductions: z.array(deductionShape).max(1000).optional(),
      deposits: z.array(depositShape).max(1000),
    },
    async (a, auditLog) => {
      const deductions = a.deductions ?? [];
      const cap = rowLimit(auditLog.grant, auditLog.limits);
      if (deductions.length + a.deposits.length > cap) {
        throw refuse(
          `A paycheck takes at most ${cap} deductions and deposits together, not ${deductions.length + a.deposits.length}.`,
        );
      }
      if (!a.name.trim()) throw refuse('name must not be empty.');
      requireAmount(a.gross_amount);
      for (const d of deductions) requireAmount(d.amount);
      const accounts = await api.getAccounts();
      const clearing = findAccount(accounts, a.clearing_account_id);
      if (clearing.offbudget) {
        throw refuse('The clearing account must be an open on-budget account.');
      }
      for (const d of a.deposits) findAccount(accounts, d.account_id);
      const accountIds = a.deposits.map(d => d.account_id);
      if (
        accountIds.includes(a.clearing_account_id) ||
        new Set(accountIds).size !== accountIds.length
      ) {
        throw refuse(
          'Each deposit must go to a different account, and not the clearing account.',
        );
      }
      for (const d of deductions) {
        if (d.transfer_account_id) findAccount(accounts, d.transfer_account_id);
      }
      if (
        a.payee_id &&
        !(await api.getPayees()).some(p => p.id === a.payee_id)
      ) {
        throw refuse(
          'payee_id must be the id of an existing payee, never a name.',
        );
      }
      const categories = (await api.getCategories()).map(c => c.id);
      for (const c of [
        a.income_category_id,
        ...deductions.map(d => d.category_id),
      ]) {
        if (c && !categories.includes(c)) {
          throw refuse('A category id must be the id of an existing category.');
        }
      }
      const date = await recurrenceValue(a.recurrence);
      const definition: PaycheckDefinition = {
        payee: a.payee_id ?? null,
        clearingAccount: a.clearing_account_id,
        date,
        weekendSolveMode: a.weekend_solve_mode ?? 'before',
        grossAmount: a.gross_amount,
        incomeCategory: a.income_category_id ?? null,
        deductions: deductions.map(d => ({
          id: randomUUID(),
          name: d.name,
          amount: d.amount,
          category: d.category_id ?? null,
          transferAccount: d.transfer_account_id ?? null,
        })),
        deposits: a.deposits.map(d => ({
          id: randomUUID(),
          account: d.account_id,
          kind: d.kind,
          value: d.value ?? 0,
          postAutomatically: d.post_automatically ?? false,
        })),
      };
      const name = a.name.trim();
      let created = '';
      requireEngine();
      return loggedWrite(
        auditLog,
        'write_create_paycheck',
        {
          ids: [a.clearing_account_id, ...a.deposits.map(d => d.account_id)],
          changes: [
            { id: 'new', field: 'name', before: null, after: name },
            { id: 'new', field: 'definition', before: null, after: definition },
          ],
        },
        async () => {
          created = await api.createPaycheck({ name, definition });
          return { applied: [created], created: [created] };
        },
        async () => {
          const made = (await api.getPaychecks()).find(p => p.id === created)!;
          return withText(
            {
              paycheck_id: created,
              schedule_ids: [
                made.definition.paySchedule,
                ...made.definition.deposits.map(d => d.schedule),
              ].filter(Boolean),
            },
            { name },
          );
        },
      );
    },
    { scopes: ['schedules:write'] },
  );

  tool(
    'write_delete_paycheck',
    "Delete a paycheck and the pay and deposit schedules it manages, by paycheck id (never a name); the clearing account and posted transactions stay. Always two steps, whatever confirm_destructive says: the first call changes nothing and returns a dry run with `confirm` and the paycheck's definition (the inputs write_create_paycheck takes, to rebuild it); call again with the `confirm` within 5 minutes. Returns the deleted id.",
    { paycheck_id: id, confirm },
    async ({ paycheck_id }, auditLog) => {
      const paycheck = (await api.getPaychecks()).find(
        p => p.id === paycheck_id,
      );
      if (!paycheck) {
        throw new Refusal(
          `paycheck_id must be the id of an existing paycheck, never a name. ${NOTHING}`,
        );
      }
      const definition = definitionOf(paycheck);
      requireEngine();
      return loggedWrite(
        auditLog,
        'write_delete_paycheck',
        {
          ids: [paycheck_id],
          changes: [
            {
              id: paycheck_id,
              field: 'name',
              before: paycheck.name,
              after: null,
            },
            {
              id: paycheck_id,
              field: 'definition',
              before: definition,
              after: null,
            },
          ],
        },
        async () => {
          await api.deletePaycheck(paycheck_id);
          return { applied: [paycheck_id] };
        },
        async () =>
          withText({ paycheck_id, deleted: true }, { name: paycheck.name }),
        {
          alwaysConfirm: true,
          dryRun: {
            definition,
            note: 'Not undoable: recreate it from this definition with write_create_paycheck.',
          },
          preview: { name: paycheck.name },
        },
      );
    },
    { scopes: ['schedules:write', 'delete'], destructive: true },
  );
}
