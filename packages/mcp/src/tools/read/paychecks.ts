import * as api from '@actual-app/api';
import { z } from 'zod';

import { pageList } from '#paging';
import { withText } from '#sanitize';

import { moneyAs, pageShape } from './shared';
import type { RegisterTool } from './shared';

// Everything in a paycheck's definition is synced data, so an id is only
// returned as an id when it looks like one; anything else is cleaned and
// moved under `text`.
const PLAIN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const KINDS = new Set(['fixed', 'percent', 'remainder']);

// A number from the definition, or null: a string there is untrusted text.
const finite = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? n : null;

function splitIds(ids: Record<string, string | null | undefined>) {
  const plain: Record<string, string | null | undefined> = {};
  const text: Record<string, string> = {};
  for (const [key, value] of Object.entries(ids)) {
    if (typeof value === 'string' && value !== '' && !PLAIN_ID.test(value)) {
      plain[key] = null;
      text[key] = value;
    } else {
      plain[key] = value;
    }
  }
  return { plain, text };
}

/** A record with its id fields; a `text` group only when one is not plain. */
function withIds(
  record: Record<string, unknown>,
  ids: Record<string, string | null | undefined>,
  text: Record<string, unknown> = {},
) {
  const split = splitIds(ids);
  const base = { ...record, ...split.plain };
  const all = { ...text, ...split.text };
  return Object.keys(all).length > 0 ? withText(base, all) : base;
}

export function registerPaycheckTools(tool: RegisterTool) {
  tool(
    'list_paychecks',
    'List paychecks with their clearing account, gross amount and deposit accounts (ids).',
    pageShape,
    async p => {
      const paychecks = await api.getPaychecks();
      return pageList(
        paychecks.map(({ id, name, definition: d }) =>
          withIds(
            {
              id,
              ...(finite(d.grossAmount) === null
                ? { gross_amount: null, gross_amount_decimal: null }
                : moneyAs('gross_amount', d.grossAmount)),
              deposits: d.deposits.map(x =>
                withIds(
                  {
                    kind: KINDS.has(x.kind) ? x.kind : 'unknown',
                    value: finite(x.value),
                  },
                  { id: x.id, account_id: x.account },
                ),
              ),
            },
            {
              clearing_account_id: d.clearingAccount,
              payee_id: d.payee,
              income_category_id: d.incomeCategory,
              pay_schedule_id: d.paySchedule ?? null,
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
        statuses.map(s =>
          withIds(
            {
              paycheck_id: s.paycheck,
              ...moneyAs('balance', s.balance),
              pay_date: s.payDate,
              missing_deposits: s.missingDeposits.map(d =>
                withIds(
                  { expected_date: d.expectedDate },
                  { id: d.id, account_id: d.account },
                ),
              ),
              is_warning: s.isWarning,
            },
            { clearing_account_id: s.clearingAccount },
          ),
        ),
        p,
      );
    },
  );
}
