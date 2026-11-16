import * as api from '@actual-app/api';
import { z } from 'zod';

import type { Scope } from '#grants';
import { Refusal } from '#refusal';
import { withText } from '#sanitize';
import { getBudgetStatus, moveConfirm } from '#tools/read/accounts';
import { date } from '#tools/read/shared';

import type { RegisterWriteTool } from './shared';
import { confirm, id, loggedWrite, requireAmount, requireDate } from './shared';

/** The scope that account and account group deletes need besides structure:write (one place to swap in `accounts:delete`). */
const ACCOUNT_DELETE_SCOPE: Scope = 'delete';

const MAX_NAME = 100;
const NOTHING = 'Nothing changed.';

type Account = Awaited<ReturnType<typeof api.getAccounts>>[number];
type AccountGroup = Awaited<ReturnType<typeof api.getAccountGroups>>[number];

function findAccount(accounts: Account[], accountId: string) {
  const found = accounts.find(a => a.id === accountId);
  if (!found) {
    throw new Refusal(
      `account_id must be the id of an existing account, never a name. ${NOTHING}`,
    );
  }
  return found;
}

function findGroup(groups: AccountGroup[], groupId: string, what: string) {
  const found = groups.find(g => g.id === groupId);
  if (!found) {
    throw new Refusal(
      `${what} must be the id of an existing account group, never a name. ${NOTHING}`,
    );
  }
  return found;
}

function requireName(raw: string) {
  const name = raw.trim();
  if (!name || name.length > MAX_NAME) {
    throw new Refusal(`name must be 1 to ${MAX_NAME} characters. ${NOTHING}`);
  }
  return name;
}

/** The app refuses a group name another group has (case-insensitive). */
function requireGroupName(raw: string, groups: AccountGroup[], self?: string) {
  const name = requireName(raw);
  if (
    groups.some(
      g => g.id !== self && g.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new Refusal(
      `An account group with that name already exists. ${NOTHING}`,
    );
  }
  return name;
}

/** The change of one field, or nothing when it did not change. */
function diff<T>(before: T, after: T) {
  return before === after ? {} : { before, after };
}

export function registerAccountWriteTools(tool: RegisterWriteTool) {
  tool(
    'write_move_on_budget',
    'Move an off-budget account on budget at a start date (YYYY-MM-DD), by account id (never a name). Call preview_move_on_budget first and pass its `confirm`: the move is refused when a fresh preview for the same account and date differs. Returns the account status before and after.',
    { account_id: id, start_date: date, confirm: z.string().max(128) },
    async ({ account_id, start_date, confirm }, auditLog) => {
      requireDate(start_date);
      const account = (await api.getAccounts()).find(a => a.id === account_id);
      if (!account) {
        throw new Refusal(
          'account_id must be the id of an existing account, never a name.',
        );
      }
      if (!account.offbudget) {
        throw new Refusal('The account is already on budget.');
      }
      const preview = await api.previewMoveAccountOnBudget(
        account_id,
        start_date,
      );
      if (moveConfirm(account_id, start_date, preview) !== confirm) {
        throw new Refusal(
          'confirm does not match a fresh preview_move_on_budget for this account and start date. Preview again.',
        );
      }
      const before = await getBudgetStatus(account_id);

      return loggedWrite(
        auditLog,
        'write_move_on_budget',
        {
          ids: [account_id],
          changes: [
            { id: account_id, field: 'offbudget', before: true, after: false },
            {
              id: account_id,
              field: 'budget_start_date',
              before: before.budget_start_date,
              after: start_date,
            },
          ],
        },
        async () => {
          await api.moveAccountOnBudget(account_id, start_date);
          return { applied: [account_id] };
        },
        async () => {
          const after = await getBudgetStatus(account_id);
          const offBudget = (await api.getAccounts()).find(
            a => a.id === account_id,
          )?.offbudget;
          return {
            account_id,
            off_budget: { before: true, after: offBudget },
            budget_start_date: {
              before: before.budget_start_date,
              after: after.budget_start_date,
            },
            budget_start_offset: after.budget_start_offset,
          };
        },
      );
    },
    { scopes: ['structure:write'] },
  );

  tool(
    'write_create_account',
    "Create an account by name, on budget unless `off_budget`, with an optional opening balance in cents. A name another account has is allowed, as in the app; the result then carries a `warnings` note with that account's id. Returns the new account id. The off-budget flag and opening balance are set here only: edit the balance with write_update_transactions and move an account on budget with write_move_on_budget.",
    {
      name: z.string(),
      off_budget: z.boolean().optional(),
      opening_balance: z.number().optional(),
    },
    async ({ name: raw, off_budget = false, opening_balance }, auditLog) => {
      const name = requireName(raw);
      if (opening_balance !== undefined) requireAmount(opening_balance);
      const same = (await api.getAccounts())
        .filter(a => a.name.toLowerCase() === name.toLowerCase())
        .map(a => a.id);
      let created = '';
      return loggedWrite(
        auditLog,
        'write_create_account',
        {
          ids: [],
          changes: [
            { id: 'new', field: 'name', before: null, after: name },
            { id: 'new', field: 'offbudget', before: null, after: off_budget },
            {
              id: 'new',
              field: 'opening_balance',
              before: null,
              after: opening_balance ?? 0,
            },
          ],
        },
        async () => {
          created = await api.createAccount(
            { name, offbudget: off_budget },
            opening_balance,
          );
          return { applied: [created], created: [created] };
        },
        async () =>
          withText(
            {
              account_id: created,
              off_budget,
              closed: false,
              opening_balance: opening_balance ?? 0,
              ...(same.length > 0
                ? {
                    warnings: [
                      `An account with this name already exists (account ids: ${same.join(', ')}).`,
                    ],
                  }
                : {}),
            },
            { name },
          ),
      );
    },
    { scopes: ['structure:write'], strict: true },
  );

  tool(
    'write_update_account',
    'Rename an account or put it in an account group, by id (never a name): give `name` and/or `account_group_id` (an account group id, or null to take it out of its group). Closing, reopening, the off-budget flag and the opening balance are not editable here: use write_reopen_account, write_move_on_budget and write_update_transactions. Returns the old and new value of each field changed.',
    {
      account_id: id,
      name: z.string().optional(),
      account_group_id: id.nullable().optional(),
    },
    async ({ account_id, name: raw, account_group_id }, auditLog) => {
      if (raw === undefined && account_group_id === undefined) {
        throw new Refusal(
          `Give a name or account_group_id to change. ${NOTHING}`,
        );
      }
      const before = findAccount(await api.getAccounts(), account_id);
      const name = raw === undefined ? undefined : requireName(raw);
      if (account_group_id) {
        findGroup(
          await api.getAccountGroups(),
          account_group_id,
          'account_group_id',
        );
      }
      // Field by field, never the input as a whole: the engine would also take closed and offbudget
      const fields = {
        ...(name === undefined ? {} : { name }),
        ...(account_group_id === undefined ? {} : { account_group_id }),
      };
      return loggedWrite(
        auditLog,
        'write_update_account',
        {
          ids: [account_id],
          changes: [
            ...(name === undefined
              ? []
              : [
                  {
                    id: account_id,
                    field: 'name',
                    before: before.name,
                    after: name,
                  },
                ]),
            ...(account_group_id === undefined
              ? []
              : [
                  {
                    id: account_id,
                    field: 'account_group_id',
                    before: before.account_group_id ?? null,
                    after: account_group_id,
                  },
                ]),
          ],
        },
        async () => {
          await api.updateAccount(account_id, fields);
          return { applied: [account_id] };
        },
        async () => {
          const after = findAccount(await api.getAccounts(), account_id);
          return withText(
            {
              account_id,
              account_group_id: diff(
                before.account_group_id ?? null,
                after.account_group_id ?? null,
              ),
            },
            { name: diff(before.name, after.name) },
          );
        },
      );
    },
    { scopes: ['structure:write'], strict: true },
  );

  tool(
    'write_reopen_account',
    'Reopen a closed account, by id (never a name). Refused when it is already open. Returns `closed` before and after.',
    { account_id: id },
    async ({ account_id }, auditLog) => {
      const before = findAccount(await api.getAccounts(), account_id);
      if (!before.closed) {
        throw new Refusal(`The account is already open. ${NOTHING}`);
      }
      return loggedWrite(
        auditLog,
        'write_reopen_account',
        {
          ids: [account_id],
          changes: [
            { id: account_id, field: 'closed', before: true, after: false },
          ],
        },
        async () => {
          await api.reopenAccount(account_id);
          return { applied: [account_id] };
        },
        async () => ({
          account_id,
          closed: {
            before: true,
            after: Boolean(
              findAccount(await api.getAccounts(), account_id).closed,
            ),
          },
        }),
      );
    },
    { scopes: ['structure:write'], strict: true },
  );

  tool(
    'write_create_account_group',
    'Create an account group by name. A name another group has (any case) is refused, as in the app. Returns the new group id.',
    { name: z.string() },
    async ({ name: raw }, auditLog) => {
      const name = requireGroupName(raw, await api.getAccountGroups());
      let created = '';
      return loggedWrite(
        auditLog,
        'write_create_account_group',
        {
          ids: [],
          changes: [{ id: 'new', field: 'name', before: null, after: name }],
        },
        async () => {
          created = await api.createAccountGroup({ name });
          return { applied: [created], created: [created] };
        },
        async () => withText({ account_group_id: created }, { name }),
      );
    },
    { scopes: ['structure:write'], strict: true },
  );

  tool(
    'write_update_account_group',
    'Rename an account group, by id (never a name). A name another group has (any case) is refused. Returns the old and new name.',
    { account_group_id: id, name: z.string() },
    async ({ account_group_id, name: raw }, auditLog) => {
      const groups = await api.getAccountGroups();
      const before = findGroup(groups, account_group_id, 'account_group_id');
      const name = requireGroupName(raw, groups, account_group_id);
      return loggedWrite(
        auditLog,
        'write_update_account_group',
        {
          ids: [account_group_id],
          changes: [
            {
              id: account_group_id,
              field: 'name',
              before: before.name,
              after: name,
            },
          ],
        },
        async () => {
          await api.updateAccountGroup(account_group_id, { name });
          return { applied: [account_group_id] };
        },
        async () => {
          const after = findGroup(
            await api.getAccountGroups(),
            account_group_id,
            'account_group_id',
          );
          return withText(
            { account_group_id },
            { name: diff(before.name, after.name) },
          );
        },
      );
    },
    { scopes: ['structure:write'], strict: true },
  );

  tool(
    'write_delete_account_group',
    'Delete an account group, by id (never a name). Its accounts are not deleted: they become ungrouped, and their ids are in the result. Needs a `confirm` from a dry run when the connection requires one.',
    { account_group_id: id, confirm },
    async ({ account_group_id }, auditLog) => {
      const before = findGroup(
        await api.getAccountGroups(),
        account_group_id,
        'account_group_id',
      );
      const members = (await api.getAccounts())
        .filter(a => a.account_group_id === account_group_id)
        .map(a => a.id);
      return loggedWrite(
        auditLog,
        'write_delete_account_group',
        {
          ids: [account_group_id, ...members],
          changes: [
            {
              id: account_group_id,
              field: 'deleted',
              before: { name: before.name, account_ids: members },
              after: null,
            },
          ],
        },
        async () => {
          await api.deleteAccountGroup(account_group_id);
          return { applied: [account_group_id] };
        },
        async () => ({
          account_group_id,
          deleted: !(await api.getAccountGroups()).some(
            g => g.id === account_group_id,
          ),
          ungrouped_account_ids: members,
        }),
      );
    },
    {
      scopes: ['structure:write', ACCOUNT_DELETE_SCOPE],
      destructive: true,
      strict: true,
    },
  );
}
