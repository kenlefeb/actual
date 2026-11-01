import * as api from '@actual-app/api';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { buildPage, pageList, pageParams } from './paging';
import { DATA_NOTE, sanitizeDeep, scrubSecrets, withText } from './sanitize';

const DESCRIPTION_NOTE = ` Read-only. ${DATA_NOTE}`;

const pageShape = {
  limit: z.number().int().optional(),
  cursor: z.string().optional(),
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/** Integer minor units plus a decimal string, so the model never does cent math. */
function money(amount: number) {
  const abs = Math.abs(amount);
  const decimal = `${amount < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return { amount, amount_decimal: decimal };
}

// Tables run_query may read.
const QUERY_TABLES = [
  'transactions',
  'accounts',
  'categories',
  'category_groups',
  'payees',
  'schedules',
  'rules',
  'tags',
] as const;

const querySchema = z
  .object({
    table: z.enum(QUERY_TABLES),
    select: z.array(z.string()).max(30).default(['*']),
    filter: z.record(z.string(), z.unknown()).optional(),
    order_by: z
      .array(
        z.union([z.string(), z.record(z.string(), z.enum(['asc', 'desc']))]),
      )
      .optional(),
  })
  // Anything beyond a select (or an unknown key) is refused, not ignored.
  .strict();

export function createServer(secrets: string[] = []) {
  const server = new McpServer({ name: 'actual-budget', version: '0.1.0' });

  // All tools are read-only; amounts are integer minor units (cents).
  function tool<S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    fn: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ) {
    const callback = async (
      args: z.infer<z.ZodObject<S>>,
    ): Promise<CallToolResult> => {
      try {
        const result = await fn(args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ note: DATA_NOTE, ...(result as object) }),
            },
          ],
        };
      } catch (error) {
        // Fixed text to the model; details (scrubbed) go to stderr only.
        const detail =
          error instanceof Error ? error.message : JSON.stringify(error);
        process.stderr.write(
          `${name} failed: ${scrubSecrets(detail, secrets)}\n`,
        );
        return {
          isError: true,
          content: [
            { type: 'text', text: `${name} failed. See the server log.` },
          ],
        };
      }
    };
    // The SDK's generic callback type can't be inferred through our wrapper.
    server.registerTool(
      name,
      { description: description + DESCRIPTION_NOTE, inputSchema: shape },
      callback as unknown as ToolCallback<S>,
    );
  }

  tool(
    'list_accounts',
    'List accounts with their current balances.',
    pageShape,
    async p => {
      const accounts = await api.getAccounts();
      const rows = await Promise.all(
        accounts.map(async a =>
          withText(
            {
              id: a.id,
              off_budget: a.offbudget,
              closed: a.closed,
              ...money(await api.getAccountBalance(a.id)),
            },
            { name: a.name },
          ),
        ),
      );
      return pageList(rows, p);
    },
  );

  tool(
    'get_account_balance',
    'Get one account balance, optionally as of a date (YYYY-MM-DD).',
    { account_id: z.string(), cutoff: date.optional() },
    async ({ account_id, cutoff }) => ({
      account_id,
      ...money(
        await api.getAccountBalance(
          account_id,
          cutoff ? new Date(`${cutoff}T00:00:00`) : undefined,
        ),
      ),
    }),
  );

  tool(
    'list_category_groups',
    'List category groups with their categories.',
    pageShape,
    async p => {
      const groups = await api.getCategoryGroups();
      return pageList(
        groups.map(g => ({
          ...withText(
            { id: g.id, is_income: g.is_income, hidden: g.hidden },
            { name: g.name },
          ),
          categories: (g.categories ?? []).map(c =>
            withText({ id: c.id, hidden: c.hidden }, { name: c.name }),
          ),
        })),
        p,
      );
    },
  );

  tool(
    'list_payees',
    'List payees, optionally filtered by a name substring.',
    { ...pageShape, search: z.string().max(100).optional() },
    async ({ search, ...p }) => {
      const needle = search?.toLowerCase();
      const payees = (await api.getPayees()).filter(
        x => !needle || x.name.toLowerCase().includes(needle),
      );
      return pageList(
        payees.map(x => withText({ id: x.id }, { name: x.name })),
        p,
      );
    },
  );

  tool(
    'list_transactions',
    'List transactions, newest first, by account, category and date range (YYYY-MM-DD). Amounts are cents.',
    {
      ...pageShape,
      account_id: z.string().optional(),
      category_id: z.string().optional(),
      start_date: date.optional(),
      end_date: date.optional(),
    },
    async ({ account_id, category_id, start_date, end_date, ...input }) => {
      const p = pageParams(input);
      const conditions: Array<Record<string, unknown>> = [];
      if (account_id) conditions.push({ account: account_id });
      if (category_id) conditions.push({ category: category_id });
      if (start_date) conditions.push({ date: { $gte: start_date } });
      if (end_date) conditions.push({ date: { $lte: end_date } });
      const base = api.q('transactions');
      const { data } = (await api.runQuery(
        (conditions.length ? base.filter({ $and: conditions }) : base)
          .select([
            'id',
            'date',
            'amount',
            'cleared',
            'account',
            'category',
            'payee.name',
            'imported_payee',
            'category.name',
            'account.name',
            'notes',
          ])
          .orderBy([{ date: 'desc' }, 'id'])
          .limit(p.limit + 1)
          .offset(p.offset),
      )) as { data: Array<Record<string, unknown>> };
      return buildPage(
        data.map(t =>
          withText(
            {
              id: t.id,
              date: t.date,
              ...money(Number(t.amount)),
              cleared: t.cleared,
              account_id: t.account,
              category_id: t.category,
            },
            {
              payee: t['payee.name'],
              imported_payee: t.imported_payee,
              category: t['category.name'],
              account: t['account.name'],
              notes: t.notes,
            },
          ),
        ),
        p,
      );
    },
  );

  tool(
    'get_budget_month',
    'Get the budget summary for one month (YYYY-MM): totals plus budgeted, spent and balance per category. Amounts are cents.',
    { month: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM') },
    async ({ month }) => {
      const m = await api.getBudgetMonth(month);
      return {
        month: m.month,
        to_budget: m.toBudget,
        total_budgeted: m.totalBudgeted,
        total_spent: m.totalSpent,
        total_balance: m.totalBalance,
        total_income: m.totalIncome,
        groups: m.categoryGroups.map(g => ({
          ...withText({ id: g.id, is_income: g.is_income }, { name: g.name }),
          categories: (g.categories ?? []).map(c =>
            withText(
              {
                id: c.id,
                budgeted: c.budgeted,
                spent: c.spent,
                balance: c.balance,
              },
              { name: c.name },
            ),
          ),
        })),
      };
    },
  );

  tool('list_schedules', 'List scheduled transactions.', pageShape, async p => {
    const schedules = await api.getSchedules();
    return pageList(
      schedules.map(s =>
        withText(
          {
            id: s.id,
            completed: s.completed,
            next_date: s.next_date,
            ...(typeof s.amount === 'number' ? money(s.amount) : {}),
          },
          { name: s.name },
        ),
      ),
      p,
    );
  });

  tool(
    'list_rules',
    'List rules with their conditions and actions.',
    pageShape,
    async p => {
      const rules = await api.getRules();
      return pageList(
        rules.map(r =>
          withText(
            { id: r.id, stage: r.stage, conditions_op: r.conditionsOp },
            { conditions: r.conditions, actions: r.actions },
          ),
        ),
        p,
      );
    },
  );

  tool(
    'run_query',
    'Run a read-only ActualQL select over one table: select fields, an AQL filter object and order_by. Anything that is not a select is refused.',
    { query: querySchema, ...pageShape },
    async ({ query, ...input }) => {
      const p = pageParams(input);
      let aql = api.q(query.table).select(query.select);
      if (query.filter) aql = aql.filter(query.filter);
      if (query.order_by) aql = aql.orderBy(query.order_by);
      const { data } = (await api.runQuery(
        aql.limit(p.limit + 1).offset(p.offset),
      )) as { data: unknown[] };
      // Every string in a row is untrusted text.
      const rows = data.map(row => {
        const clean = sanitizeDeep(row);
        return { text: clean.value, truncated: clean.truncated };
      });
      return buildPage(rows, p);
    },
  );

  tool(
    'sync_budget',
    'Syncs the local budget copy with the server, exactly as the app does. A sync can post due auto-post schedules and paycheck reconciles, and a later sync pushes them.',
    {},
    async () => {
      await api.sync();
      return { synced: true };
    },
  );

  return server;
}
