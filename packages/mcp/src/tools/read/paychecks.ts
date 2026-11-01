import * as api from '@actual-app/api';
import { z } from 'zod';

import { pageList } from '#paging';
import { withText } from '#sanitize';

import { moneyAs, pageShape } from './shared';
import type { RegisterTool } from './shared';

export function registerPaycheckTools(tool: RegisterTool) {
  tool(
    'list_paychecks',
    'List paychecks with their clearing account, gross amount and deposit accounts (ids).',
    pageShape,
    async p => {
      const paychecks = await api.getPaychecks();
      return pageList(
        paychecks.map(({ id, name, definition: d }) =>
          withText(
            {
              id,
              clearing_account_id: d.clearingAccount,
              payee_id: d.payee,
              income_category_id: d.incomeCategory,
              pay_schedule_id: d.paySchedule ?? null,
              ...moneyAs('gross_amount', d.grossAmount),
              deposits: d.deposits.map(x => ({
                id: x.id,
                account_id: x.account,
                kind: x.kind,
                value: x.value,
              })),
            },
            { name, deductions: d.deductions.map(x => x.name) },
          ),
        ),
        p,
      );
    },
  );

  tool(
    'get_paycheck_year_to_date',
    "Get a paycheck's posted pay totals (gross, deductions, net) for this calendar year and last, as the app shows them. Amounts are cents.",
    { paycheck_id: z.string() },
    async ({ paycheck_id }) => {
      const years = await api.getPaycheckYearToDate(paycheck_id);
      return {
        paycheck_id,
        years: years.map(y => ({
          year: y.year,
          ...moneyAs('gross', y.gross),
          ...moneyAs('net', y.net),
          deductions: y.deductions.map(d =>
            withText(moneyAs('amount', d.amount), { name: d.name }),
          ),
        })),
      };
    },
  );

  tool(
    'get_paychecks_clearing_status',
    "List each paycheck's clearing account balance, latest pay date and deposits not yet linked. A warning means the balance should be zero by now and is not.",
    pageShape,
    async p => {
      const statuses = await api.getPaychecksClearingStatus();
      return pageList(
        statuses.map(s => ({
          paycheck_id: s.paycheck,
          clearing_account_id: s.clearingAccount,
          ...moneyAs('balance', s.balance),
          pay_date: s.payDate,
          missing_deposits: s.missingDeposits.map(d => ({
            id: d.id,
            account_id: d.account,
            expected_date: d.expectedDate,
          })),
          is_warning: s.isWarning,
        })),
        p,
      );
    },
  );
}
