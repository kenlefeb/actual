import * as api from '@actual-app/api';

import { appendAudit } from '#audit';
import { Refusal } from '#tools/read/shared';
import type { RegisterTool } from '#tools/read/shared';

import { id } from './shared';

async function nextDate(scheduleId: string | null | undefined) {
  if (!scheduleId) return null;
  const { data } = (await api.runQuery(
    api.q('schedules').filter({ id: scheduleId }).select(['next_date']),
  )) as { data: Array<{ next_date: string | null }> };
  return data[0]?.next_date ?? null;
}

export function registerPaycheckWriteTools(
  tool: RegisterTool,
  auditLog: string,
) {
  tool(
    'write_skip_paycheck',
    "Skip a paycheck's next pay date (its pay and deposit schedules), by paycheck id (never a name). Returns the next pay date before and after.",
    { paycheck_id: id },
    async ({ paycheck_id }) => {
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

      // Log first: a failed append stops the write.
      appendAudit(auditLog, {
        tool: 'write_skip_paycheck',
        ids: [paycheck_id],
        changes: [
          { id: paycheck_id, field: 'next_date', before, after: 'skipped' },
        ],
      });
      await api.skipNextPaycheck(paycheck_id);

      return {
        paycheck_id,
        next_date: { before, after: await nextDate(schedule) },
      };
    },
  );
}
