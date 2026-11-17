// The statement balance a reconcile starts from, and its record (openspec/changes/native-reconcile-flow, D2-D4)
import { useEffect, useState } from 'react';

import { send } from '@actual-app/core/platform/client/connection';
import type {
  getStatementBalancePrefill,
  StatementBalanceRecord,
} from '@actual-app/core/server/accounts/statement-balance';

export type StatementBalancePrefill = Awaited<
  ReturnType<typeof getStatementBalancePrefill>
>;
export type BalanceSource = StatementBalancePrefill['alternatives'][number];

/** The resolver's answer for the account; null until it arrives (or if it fails). */
export function useStatementBalancePrefill(accountId: string) {
  const [prefill, setPrefill] = useState<StatementBalancePrefill | null>(null);
  useEffect(() => {
    let cancelled = false;
    void send('account-statement-balance-prefill', {
      account_id: accountId,
    }).then(
      result => !cancelled && setPrefill(result),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [accountId]);
  return prefill;
}

/**
 * What confirming records: the applied source while unedited, `entered` once
 * the person typed. The record is for the assistant; failing to save it never
 * blocks the person's own reconcile.
 */
export async function recordStatementBalance(
  accountId: string,
  amount: number,
  applied: BalanceSource | null,
  edited: boolean,
): Promise<StatementBalanceRecord['source'] | null> {
  const source = applied && !edited ? applied.source : 'entered';
  try {
    await send('account-statement-balance-save', {
      account_id: accountId,
      amount,
      source,
      as_of: source === 'bank-sync' ? (applied?.as_of ?? null) : null,
    });
    return source;
  } catch {
    return null;
  }
}

const PROVIDERS: Record<string, string> = {
  simpleFin: 'SimpleFIN',
  goCardless: 'GoCardless',
  pluggyai: 'Pluggy.ai',
  enableBanking: 'Enable Banking',
  akahu: 'Akahu',
};

export const providerName = (source: string | null | undefined) =>
  (source && PROVIDERS[source]) || null;
