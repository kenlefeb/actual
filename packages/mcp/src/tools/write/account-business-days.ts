import * as api from '@actual-app/api';
import { z } from 'zod';

import { appendAudit } from '#audit';
import { Refusal } from '#refusal';

import { findAccount, NOTHING } from './accounts';
import type { RegisterWriteTool } from './shared';
import { id, loggedWrite } from './shared';

type Paycheck = Awaited<ReturnType<typeof api.getPaychecks>>[number];
type Schedule = Awaited<ReturnType<typeof api.getSchedules>>[number];

/** The generated schedules a paycheck's definition records. */
const recorded = (p: Paycheck) =>
  [
    p.definition.paySchedule,
    ...p.definition.deposits.map(d => d.schedule),
  ].filter((s): s is string => Boolean(s));

/** The dates its schedules show now: the pay date and each deposit's. */
function datesOf(p: Paycheck, schedules: Schedule[]) {
  const next = (sid?: string | null) =>
    schedules.find(s => s.id === sid)?.next_date ?? null;
  return {
    pay_date: next(p.definition.paySchedule),
    deposit_dates: p.definition.deposits.map(d => next(d.schedule)),
  };
}

/**
 * Pay dates a regeneration would clear: a schedule whose stored next date is
 * later than the one its rule gives from today was skipped. A skip only moves
 * a date forward, so an earlier stored date is overdue, not skipped.
 */
async function skippedDates(schedule: Schedule) {
  if (!schedule.next_date) return null;
  const [natural] = await api.getScheduleDates(schedule.date, { count: 1 });
  return natural && schedule.next_date > natural ? natural : null;
}

export function registerAccountBusinessDaysTool(tool: RegisterWriteTool) {
  tool(
    'write_set_account_business_days',
    "Set the business calendar (an id from list_business_calendars, or null for Saturday and Sunday) and the whole days early (0 to 10) an account's paycheck deposits use, as the app does, and regenerate the paychecks that deposit into it. Returns the old and new values and each affected paycheck's next pay and deposit dates before and after; paychecks that only name the account elsewhere (a deduction transfer or clearing account) are regenerated too and listed as also_regenerated. Refused, naming `allow_regenerate`, when regenerating would clear a skipped pay date or recreate a schedule deleted elsewhere; with allow_regenerate true it does what the app does, and recreating a deleted schedule also needs the delete scope.",
    {
      account_id: id,
      business_calendar_id: id.nullable(),
      deposit_days_early: z.number().int().min(0).max(10),
      allow_regenerate: z.boolean().optional(),
    },
    async (
      {
        account_id,
        business_calendar_id,
        deposit_days_early,
        allow_regenerate = false,
      },
      auditLog,
    ) => {
      const account = findAccount(await api.getAccounts(), account_id);
      if (
        business_calendar_id !== null &&
        !(await api.getBusinessCalendars()).some(
          c => c.id === business_calendar_id,
        )
      ) {
        throw new Refusal(
          `business_calendar_id must be the id of an existing business calendar, or null. ${NOTHING}`,
        );
      }
      const oldCalendar = account.business_calendar_id ?? null;
      const oldDays = account.deposit_days_early ?? 0;
      if (
        oldCalendar === business_calendar_id &&
        oldDays === deposit_days_early
      ) {
        throw new Refusal('Nothing to change.');
      }

      // Every paycheck the engine regenerates: the account id anywhere in the definition
      const paychecks = (await api.getPaychecks()).filter(p =>
        JSON.stringify(p.definition).includes(`"${account_id}"`),
      );
      const affected = paychecks.filter(p =>
        p.definition.deposits.some(d => d.account === account_id),
      );
      const also = paychecks.filter(p => !affected.includes(p));
      const schedules = await api.getSchedules();
      const live = new Set(schedules.map(s => s.id));
      const missing = paychecks.filter(p =>
        recorded(p).some(sid => !live.has(sid)),
      );
      const skipped: Array<{ paycheck_id: string; date: string }> = [];
      for (const p of paychecks) {
        for (const sid of recorded(p)) {
          const s = schedules.find(x => x.id === sid);
          const date = s ? await skippedDates(s) : null;
          if (date) skipped.push({ paycheck_id: p.id, date });
        }
      }

      const needsFlag = missing.length > 0 || skipped.length > 0;
      if (needsFlag && !allow_regenerate) {
        const names = [
          ...new Set([
            ...missing.map(p => p.id),
            ...skipped.map(s => s.paycheck_id),
          ]),
        ];
        throw new Refusal(
          `Regenerating would ${missing.length > 0 ? 'recreate a schedule deleted elsewhere' : 'clear a skipped pay date'} (paycheck ids: ${names.join(', ')}). Pass allow_regenerate true to do what the app does. ${NOTHING}`,
        );
      }
      const flagged = needsFlag && allow_regenerate;
      const recreates = missing.length > 0;
      // The scopes a call needs depend on the data, so the grant is checked here, before any audit attempt
      if (flagged && recreates && !auditLog.grant.scopes.includes('delete')) {
        try {
          if (auditLog.path) {
            appendAudit(
              auditLog.path,
              {
                tool: 'write_set_account_business_days',
                phase: 'refused',
                missing: ['delete'],
              },
              auditLog.identity,
            );
          }
        } catch {
          // Best effort: the refusal stands without its line.
        }
        throw new Refusal(
          `write_set_account_business_days needs delete to recreate a deleted schedule; missing delete; this connection was granted ${auditLog.grant.scopes.join(' ') || 'nothing'}. ${NOTHING}`,
        );
      }

      const before = new Map(
        paychecks.map(p => [p.id, datesOf(p, schedules)] as const),
      );
      let afterPaychecks: Paycheck[] = paychecks;
      let afterDates = new Map<string, ReturnType<typeof datesOf>>();
      return loggedWrite(
        auditLog,
        'write_set_account_business_days',
        {
          ids: [account_id, ...affected.map(p => p.id)],
          changes: [
            {
              id: account_id,
              field: 'business_calendar_id',
              before: oldCalendar,
              after: business_calendar_id,
            },
            {
              id: account_id,
              field: 'deposit_days_early',
              before: oldDays,
              after: deposit_days_early,
            },
            ...affected.map(p => ({
              id: p.id,
              field: 'dates',
              before: before.get(p.id),
              after: 'regenerated',
            })),
          ],
          also_regenerated: also.map(p => p.id),
          ...(flagged
            ? {
                allow_regenerate: true,
                recreates_schedules: recreates,
                recreated_for: missing.map(p => p.id),
                skipped_dates_cleared: skipped,
              }
            : {}),
        },
        async () => {
          await api.setAccountBusinessDays(account_id, {
            businessCalendarId: business_calendar_id,
            depositDaysEarly: deposit_days_early,
          });
          const now = await api.getPaychecks();
          const nowSchedules = await api.getSchedules();
          afterPaychecks = now.filter(p => before.has(p.id));
          afterDates = new Map(
            afterPaychecks.map(p => [p.id, datesOf(p, nowSchedules)] as const),
          );
          const known = new Set(paychecks.flatMap(recorded));
          const created = afterPaychecks
            .flatMap(recorded)
            .filter(sid => !known.has(sid));
          return {
            applied: [account_id],
            created,
            detail: {
              paychecks: affected.map(p => ({
                paycheck_id: p.id,
                before: before.get(p.id),
                after: afterDates.get(p.id),
              })),
            },
          };
        },
        async () => {
          const now = findAccount(await api.getAccounts(), account_id);
          return {
            account_id,
            business_calendar_id: {
              before: oldCalendar,
              after: now.business_calendar_id ?? null,
            },
            deposit_days_early: {
              before: oldDays,
              after: now.deposit_days_early ?? 0,
            },
            paychecks: affected.map(p => ({
              paycheck_id: p.id,
              pay_date: {
                before: before.get(p.id)?.pay_date ?? null,
                after: afterDates.get(p.id)?.pay_date ?? null,
              },
              deposit_dates: {
                before: before.get(p.id)?.deposit_dates ?? [],
                after: afterDates.get(p.id)?.deposit_dates ?? [],
              },
            })),
            also_regenerated: also.map(p => p.id),
          };
        },
      );
    },
    { scopes: ['structure:write', 'schedules:write'], strict: true },
  );
}
