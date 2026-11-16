import * as api from '@actual-app/api';
import { z } from 'zod';

import { Refusal } from '#refusal';

import { ACCOUNT_DELETE_SCOPE, findAccount, NOTHING } from './accounts';
import type { RegisterWriteTool } from './shared';
import { confirm, id, loggedWrite, requireIds, requireRows } from './shared';

const BANK_SYNC =
  'Closing or deleting an account unlinks it from bank sync first, and that cannot be undone.';

type Facts = {
  name: string;
  offbudget: boolean;
  account_group_id: string | null;
  closed: boolean;
  balance: number;
  transactions: number;
  reconciled: number;
  /** Transfer partners in other accounts, which lose their link. */
  partner_ids: string[];
  partners_reconciled: number;
  bank_linked: boolean;
  /** The provider's name, never a token or an external id. */
  bank_provider: string | null;
};

type TxRow = {
  id: string;
  reconciled: boolean;
  transfer_id: string | null;
};

/** What a close or delete touches, counted over every row the engine does (split children too). */
async function factsOf(accountId: string): Promise<Facts> {
  const account = findAccount(await api.getAccounts(), accountId);
  const { data } = (await api.runQuery(
    api
      .q('transactions')
      .filter({ account: accountId })
      .select(['id', 'reconciled', 'transfer_id'])
      .options({ splits: 'all' }),
  )) as { data: TxRow[] };
  const partner_ids = data.flatMap(r => (r.transfer_id ? [r.transfer_id] : []));
  const partners =
    partner_ids.length === 0
      ? []
      : (
          (await api.runQuery(
            api
              .q('transactions')
              .filter({ id: { $oneof: partner_ids } })
              .select(['id', 'reconciled']),
          )) as { data: Array<{ reconciled: boolean }> }
        ).data;
  const { data: link } = (await api.runQuery(
    api
      .q('accounts')
      .filter({ id: accountId })
      .select(['account_id', 'account_sync_source']),
  )) as {
    data: Array<{
      account_id: string | null;
      account_sync_source: string | null;
    }>;
  };
  return {
    name: account.name,
    offbudget: Boolean(account.offbudget),
    account_group_id: account.account_group_id ?? null,
    closed: Boolean(account.closed),
    balance: await api.getAccountBalance(accountId),
    transactions: data.length,
    reconciled: data.filter(r => r.reconciled).length,
    partner_ids,
    partners_reconciled: partners.filter(r => r.reconciled).length,
    bank_linked: Boolean(link[0]?.account_id),
    bank_provider: link[0]?.account_sync_source ?? null,
  };
}

const exists = async (accountId: string) =>
  (await api.getAccounts()).find(a => a.id === accountId);

export function registerAccountCloseTools(tool: RegisterWriteTool) {
  tool(
    'write_close_account',
    `Close an open account, by id (never a name), as the app does. When its balance is not zero, pass \`transfer_account_id\` (an open account other than itself) and, only when the transfer crosses the on-budget line (one account on budget, one off), \`transfer_category_id\`. An account with no transactions is deleted instead. ${BANK_SYNC} Needs a \`confirm\` from a dry run when the connection requires one. Returns the account's state before and after.`,
    {
      account_id: id,
      transfer_account_id: id.optional(),
      transfer_category_id: id.optional(),
      confirm,
    },
    async (
      { account_id, transfer_account_id, transfer_category_id },
      auditLog,
    ) => {
      const accounts = await api.getAccounts();
      const account = findAccount(accounts, account_id);
      if (account.closed) {
        throw new Refusal(`The account is already closed. ${NOTHING}`);
      }
      const facts = await factsOf(account_id);
      // The engine unlinks bank sync before it checks anything: refuse everything here first
      if (facts.transactions > 0 && facts.balance !== 0) {
        if (!transfer_account_id) {
          throw new Refusal(
            `The balance is not zero: pass transfer_account_id. ${NOTHING}`,
          );
        }
        const target = accounts.find(a => a.id === transfer_account_id);
        if (!target || target.id === account_id || target.closed) {
          throw new Refusal(
            `transfer_account_id must be the id of an open account other than this one. ${NOTHING}`,
          );
        }
        const crosses = Boolean(target.offbudget) !== facts.offbudget;
        if (crosses && !transfer_category_id) {
          throw new Refusal(
            `The transfer crosses the on-budget line: pass transfer_category_id. ${NOTHING}`,
          );
        }
        if (!crosses && transfer_category_id) {
          throw new Refusal(
            `transfer_category_id is only for a transfer that crosses the on-budget line. ${NOTHING}`,
          );
        }
        if (transfer_category_id) {
          await requireIds('categories', [transfer_category_id]);
        }
      } else if (transfer_account_id || transfer_category_id) {
        throw new Refusal(
          `There is no balance to transfer: leave out transfer_account_id and transfer_category_id. ${NOTHING}`,
        );
      }
      const deletes = facts.transactions === 0;

      return loggedWrite(
        auditLog,
        'write_close_account',
        {
          ids: [account_id],
          changes: [
            {
              id: account_id,
              field: deletes ? 'deleted' : 'closed',
              before: facts,
              after: deletes
                ? null
                : {
                    closed: true,
                    transfer_account_id: transfer_account_id ?? null,
                    transfer_category_id: transfer_category_id ?? null,
                  },
            },
          ],
          unlinks_bank_sync: facts.bank_linked,
        },
        async () => {
          await api.closeAccount(
            account_id,
            transfer_account_id,
            transfer_category_id,
          );
          const after = await exists(account_id);
          if (after && !after.closed) {
            return { applied: [], failed: account_id };
          }
          if (!after) return { applied: [account_id] };
          const { data } = (await api.runQuery(
            api
              .q('transactions')
              .filter({ account: account_id, notes: 'Closing account' })
              .select(['id']),
          )) as { data: Array<{ id: string }> };
          return { applied: [account_id], created: data.map(r => r.id) };
        },
        async () => {
          const after = await exists(account_id);
          return {
            account_id,
            deleted: !after,
            closed: {
              before: false,
              after: after ? Boolean(after.closed) : null,
            },
          };
        },
      );
    },
    {
      scopes: ['structure:write', ACCOUNT_DELETE_SCOPE],
      destructive: true,
      strict: true,
    },
  );

  tool(
    'write_delete_account',
    `Delete an open account and every transaction in it, by id (never a name), as the app's delete does. A closed account is refused: reopen it first. Transfers to it lose their payee and link on the other side. Refused when the account (or a transfer partner) holds a reconciled transaction unless \`allow_reconciled\` is true and the connection allows it, and when it holds more rows than the connection's row cap (split children count). ${BANK_SYNC} Needs a \`confirm\` from a dry run when the connection requires one. Returns the counts deleted.`,
    {
      account_id: id,
      allow_reconciled: z.boolean().optional(),
      confirm,
    },
    async ({ account_id, allow_reconciled }, auditLog) => {
      const account = findAccount(await api.getAccounts(), account_id);
      if (account.closed) {
        throw new Refusal(
          `A closed account can't be deleted; reopen it first. ${NOTHING}`,
        );
      }
      if (allow_reconciled && !auditLog.grant.allow_reconciled) {
        throw new Refusal(
          `This connection's grant does not allow overriding reconciled transactions. Delete the account in the app. ${NOTHING}`,
        );
      }
      const facts = await factsOf(account_id);
      if (
        (facts.reconciled > 0 || facts.partners_reconciled > 0) &&
        !allow_reconciled
      ) {
        throw new Refusal(
          `The account or a transfer partner holds reconciled transactions (${facts.reconciled} here, ${facts.partners_reconciled} in other accounts). Pass allow_reconciled true if the connection allows it. ${NOTHING}`,
        );
      }
      requireRows(auditLog, facts.transactions + facts.partner_ids.length);

      return loggedWrite(
        auditLog,
        'write_delete_account',
        {
          ids: [account_id, ...facts.partner_ids],
          changes: [
            { id: account_id, field: 'deleted', before: facts, after: null },
          ],
          unlinks_bank_sync: facts.bank_linked,
          ...(allow_reconciled ? { allow_reconciled: true } : {}),
        },
        async () => {
          await api.deleteAccount(account_id);
          // The engine does nothing in some states: never report success unless it is gone
          return (await exists(account_id))
            ? { applied: [], failed: account_id }
            : { applied: [account_id] };
        },
        async () => ({
          account_id,
          deleted: !(await exists(account_id)),
          transactions_deleted: facts.transactions,
          partners_unlinked: facts.partner_ids,
        }),
      );
    },
    {
      scopes: ['structure:write', ACCOUNT_DELETE_SCOPE, 'transactions:write'],
      destructive: true,
      strict: true,
    },
  );
}
