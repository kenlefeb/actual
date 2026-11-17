import { createHash } from 'crypto';

import * as api from '@actual-app/api';

import { ENVELOPE_BYTES } from '#paging';
import { Refusal } from '#refusal';
import {
  accountRows,
  lastReconciledOf,
  RECON_FIELDS,
  reconciliation,
} from '#tools/read/reconciliation';
import type { ReconRow } from '#tools/read/reconciliation';
import {
  recordFacts,
  requireUsableRecord,
} from '#tools/read/statement-balance';
import type { StatementBalanceRecord } from '#tools/read/statement-balance';

import { findAccount, NOTHING } from './accounts';
import type { RegisterWriteTool, WriteLog } from './shared';
import {
  confirm,
  id,
  isDryRun,
  loggedWrite,
  requireReconcileRows,
} from './shared';

/** Fixed text on every dry run: the lock cannot be undone through MCP. */
const NOTICE =
  "These rows are locked (reconciled) once you confirm. MCP cannot unlock them: write_undo cannot reverse this, and unlocking is possible only in the app or, once released, with write_unlock_transactions and the grant's allow_reconciled. Confirm only when the statement balance is right.";
const NOT_CONSUMED =
  'The rows are locked, but the recorded statement balance could not be marked used, so it is not consumed. Tell the user; they can enter it again in the app.';
const UNVERIFIED =
  'The balance no longer equals the statement balance after the lock (a sync or the app added or changed a cleared row). The rows listed in locked_ids stay locked and last_reconciled was not stamped. Unlock in the app if this is wrong.';

/** Rows involved in a lock, with the digest the confirm binds. */
async function planFor(accountId: string, record: StatementBalanceRecord) {
  const statement = record.amount;
  const rows = await accountRows(accountId);
  const r = reconciliation(rows);
  const toLock: ReconRow[] = [...r.selected, ...r.children];
  const partnerIds = [
    ...new Set(toLock.flatMap(t => (t.transfer_id ? [t.transfer_id] : []))),
  ];
  const partners =
    partnerIds.length === 0
      ? []
      : (
          (await api.runQuery(
            api
              .q('transactions')
              .filter({ id: { $oneof: partnerIds } })
              .options({ splits: 'all' })
              .select(RECON_FIELDS),
          )) as { data: ReconRow[] }
        ).data;
  const involved = [...toLock, ...partners].sort((a, b) =>
    a.id < b.id ? -1 : 1,
  );
  const plan_digest = createHash('sha256')
    .update(
      JSON.stringify([
        r.clearedBalance,
        statement,
        // A record replaced between the two steps changes the digest
        [record.id, record.source, record.entered_at],
        involved.map(t => [
          t.id,
          t.amount,
          t.date,
          t.account,
          t.cleared,
          t.reconciled,
          t.parent_id,
          t.transfer_id,
        ]),
      ]),
    )
    .digest('hex');
  return {
    clearedBalance: r.clearedBalance,
    // Only parents and ordinary rows are sent: the engine locks a parent's children with it
    sends: r.selected.map(t => t.id),
    lockIds: toLock.map(t => t.id),
    partnerIds: partners.map(t => t.id).sort(),
    skipped: [...r.skippedChildren].sort(),
    plan_digest,
  };
}

/** A dry run is never shortened: one that does not fit the response size is refused, with no confirm. */
function requireDryRunFits(log: WriteLog, shown: object) {
  if (
    isDryRun(log, false, true) &&
    Buffer.byteLength(JSON.stringify(shown)) + ENVELOPE_BYTES >
      log.limits.maxResponseBytes
  ) {
    throw new Refusal(
      `The dry run would list more row ids than fit in one response (${log.limits.maxResponseBytes} bytes), and it is never shortened, so no confirm is issued. Nothing changed. Raise MAX_RESPONSE_BYTES (up to its ceiling) or lower the rows to lock.`,
    );
  }
}

export function registerReconcileTool(tool: RegisterWriteTool) {
  tool(
    'write_reconcile_account',
    "Reconcile an account to the statement balance its user recorded in the app, by account id (never a name). The tool takes no statement balance: it uses only the account's recorded balance (get_account_reconciliation shows its status), refuses when there is none, it is expired or already used, or it was filled from the cleared balance, and consumes it when rows are locked. Computes the cleared balance as the app does (split children left out). Only when the difference is zero does it lock the cleared, unreconciled rows (a split parent with all its children) and stamp the account's last_reconciled; a difference writes nothing and issues no confirm, and no adjustment row is ever created (use write_create_transactions for that, on the user's say-so). Always two steps: the first call returns a dry run listing the rows, the transfer partners the lock freezes, the balances and a fixed warning, whatever confirm_destructive says; call again with its `confirm`. MCP cannot unlock the rows afterwards: write_undo does not reverse it. get_account_reconciliation reads the same numbers, but its balance is not proof of a statement balance. Returns the locked ids and whether the balance still matches after the lock (`verified`).",
    {
      account_id: id,
      confirm,
    },
    async ({ account_id }, auditLog) => {
      const account = findAccount(await api.getAccounts(), account_id);
      if (account.closed) {
        throw new Refusal(`A closed account cannot be reconciled. ${NOTHING}`);
      }
      const record = await requireUsableRecord(account_id, auditLog.limits);
      const statement_balance = record.amount;
      const plan = await planFor(account_id, record);
      const difference = statement_balance - plan.clearedBalance;
      if (difference !== 0) {
        return {
          account_id,
          reconciled: false,
          statement_balance,
          statement_balance_record: recordFacts(record),
          cleared_balance: plan.clearedBalance,
          difference,
          note: 'The statement balance differs from the cleared balance, so nothing was locked and no confirm was issued. Find the missing or wrong rows, or create an adjustment with write_create_transactions if the user says so.',
        };
      }
      requireReconcileRows(auditLog, plan.lockIds.length);
      const before = await lastReconciledOf(account_id);
      const facts = {
        account_id,
        statement_balance,
        statement_balance_record: recordFacts(record),
        cleared_balance: plan.clearedBalance,
        difference,
        rows_to_lock: plan.lockIds.length,
        partner_ids: plan.partnerIds,
        skipped_children: plan.skipped,
        notice: NOTICE,
      };
      requireDryRunFits(auditLog, { ids: plan.lockIds, ...facts });

      let stamp: string | null = null;
      let after = { cleared: plan.clearedBalance, ok: true };
      let lockedNow: string[] = [];
      let consumed = false;
      return loggedWrite(
        auditLog,
        'write_reconcile_account',
        {
          ids: plan.lockIds,
          // The stamp is set at lock time; the outcome line holds its value
          changes: [
            {
              id: account_id,
              field: 'last_reconciled',
              before,
              after: 'now',
            },
          ],
          statement_balance,
          // Provenance in the audit line; no age, so the confirm still matches
          statement_balance_record: {
            id: record.id,
            amount: record.amount,
            source: record.source,
            as_of: record.as_of,
            entered_at: record.entered_at,
            entered_by: record.entered_by,
          },
          cleared_balance: plan.clearedBalance,
          difference,
          plan_digest: plan.plan_digest,
        },
        async () => {
          // The app or a sync is not behind the write lock: the record must still
          // be usable (a second confirm finds the first's consume), and nothing moved
          const current = await requireUsableRecord(
            account_id,
            auditLog.limits,
          );
          const again = await planFor(account_id, current);
          if (again.plan_digest !== plan.plan_digest) {
            throw new Refusal(
              `The account changed since the dry run. ${NOTHING}`,
            );
          }
          if (plan.sends.length > 0) {
            await api.updateTransactions(
              plan.sends.map(rowId => ({
                id: rowId,
                fields: { reconciled: true },
              })),
            );
          }
          const r = reconciliation(await accountRows(account_id));
          after = {
            cleared: r.clearedBalance,
            ok: r.clearedBalance === statement_balance,
          };
          const now = new Map(
            (await accountRows(account_id)).map(t => [t.id, t.reconciled]),
          );
          lockedNow = plan.lockIds.filter(rowId => now.get(rowId));
          // The person's balance was used once rows are locked, verified or not
          // (and after a verified zero-row stamp); a zero-row mismatch uses nothing
          if (lockedNow.length > 0 || after.ok) {
            try {
              consumed = (
                await api.consumeAccountStatementBalance(account_id, record.id)
              ).consumed;
            } catch {
              consumed = false;
            }
          }
          if (after.ok) {
            stamp = String(Date.now());
            try {
              await api.updateAccount(account_id, { last_reconciled: stamp });
            } catch {
              // The rows are locked; say so instead of reporting a clean failure
              stamp = null;
              return {
                applied: lockedNow,
                failed: account_id,
                detail: { verified: true, last_reconciled: null, consumed },
              };
            }
          }
          return {
            applied: lockedNow,
            detail: {
              verified: after.ok,
              consumed,
              last_reconciled: stamp,
              cleared_balance: after.cleared,
              difference: statement_balance - after.cleared,
            },
          };
        },
        async outcome => ({
          ...facts,
          notice: undefined,
          reconciled: stamp !== null,
          verified: after.ok,
          consumed,
          cleared_balance: after.cleared,
          difference: statement_balance - after.cleared,
          locked: lockedNow.length,
          locked_ids: lockedNow,
          last_reconciled: stamp,
          ...(outcome.failed
            ? {
                failure:
                  'The rows were locked but last_reconciled could not be stamped. Unlock in the app if this is wrong.',
              }
            : {}),
          ...(after.ok ? {} : { notice: UNVERIFIED }),
          ...(!consumed && (lockedNow.length > 0 || after.ok)
            ? { notice: `${after.ok ? '' : UNVERIFIED + ' '}${NOT_CONSUMED}` }
            : {}),
        }),
        {
          alwaysConfirm: true,
          dryRun: facts,
          // Under `text`, as data
          preview: { entered_by: record.entered_by },
        },
      );
    },
    { scopes: ['transactions:reconcile'], strict: true },
  );
}
