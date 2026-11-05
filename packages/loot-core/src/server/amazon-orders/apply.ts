import * as db from '#server/db';
import { batchUpdateTransactions } from '#server/transactions';
import { getRuleCategory } from '#server/transactions/transaction-rules';
import { makeChild } from '#shared/transactions';
import type { TransactionEntity } from '#types/models';

import { hasAnyOrderMarker, orderMarker } from './marker';
import type {
  AmazonApplyMatch,
  AmazonApplyResult,
  AmazonApplySkipReason,
  AmazonCharge,
} from './types';

type Line = { amount: number; note: string };

/**
 * One line per item at price × quantity, with tax, shipping and discounts
 * shared out in proportion to those prices. Leftover cents go to the largest
 * line, so the lines add up to `total` exactly. Zero lines are folded into
 * the largest line's note. Amounts are positive here.
 */
export function allocateLines(charge: AmazonCharge, total: number): Line[] {
  const items = charge.items.map(item => ({
    note: `${item.name} ×${item.quantity}`,
    base: item.price * item.quantity,
  }));
  const baseTotal = items.reduce((sum, i) => sum + i.base, 0);
  const extra = total - baseTotal;
  const lines = items.map(i => ({
    note: i.note,
    amount:
      i.base + (baseTotal === 0 ? 0 : Math.round((extra * i.base) / baseTotal)),
  }));

  let largest = 0;
  lines.forEach((line, i) => {
    if (line.amount > lines[largest].amount) {
      largest = i;
    }
  });
  lines[largest].amount += total - lines.reduce((sum, l) => sum + l.amount, 0);

  const zeros = lines.filter(l => l.amount === 0).map(l => l.note);
  if (zeros.length > 0) {
    lines[largest].note = [lines[largest].note, ...zeros].join(', ');
  }
  return lines.filter(l => l.amount !== 0);
}

function skipReason(
  trans: TransactionEntity | undefined,
  charge: AmazonCharge,
): AmazonApplySkipReason | null {
  if (!trans || trans.tombstone) {
    return 'missing';
  }
  if (trans.amount !== -charge.amount) {
    return 'amount-changed';
  }
  if (trans.is_parent || trans.is_child) {
    return 'split';
  }
  if (trans.transfer_id) {
    return 'transfer';
  }
  if (hasAnyOrderMarker(trans.notes)) {
    return 'already-itemized';
  }
  return null;
}

function joinNotes(...parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join('\n');
}

export async function applyAmazonMatches(
  matches: AmazonApplyMatch[],
): Promise<AmazonApplyResult> {
  const result: AmazonApplyResult = { applied: [], skipped: [] };
  const added: TransactionEntity[] = [];
  const updated: Array<Partial<TransactionEntity> & { id: string }> = [];
  // A transaction may appear twice when the user picked it for two charges
  const used = new Set<string>();

  for (const { charge, transactionId } of matches) {
    const trans: TransactionEntity | undefined =
      await db.getTransaction(transactionId);
    const reason = used.has(transactionId)
      ? 'already-itemized'
      : skipReason(trans, charge);
    if (reason || !trans) {
      result.skipped.push({
        chargeId: charge.id,
        transactionId,
        reason: reason ?? 'missing',
      });
      continue;
    }
    used.add(transactionId);

    const formerCategory = trans.category ?? null;
    const lines = allocateLines(charge, charge.amount);
    const categorized = await Promise.all(
      lines.map(async line => ({
        ...line,
        category:
          (await getRuleCategory({
            account: trans.account,
            payee: trans.payee,
            date: trans.date,
            amount: -line.amount,
            notes: line.note,
          })) ?? formerCategory,
      })),
    );
    const marker = orderMarker(charge.orderId);

    if (categorized.length === 1) {
      // A one-line split could be matched by its child on a bank-file
      // re-import, so annotate the transaction instead (design decision 6)
      const [line] = categorized;
      updated.push({
        id: trans.id,
        notes: joinNotes(trans.notes, line.note, marker),
        category: line.category ?? undefined,
      });
    } else {
      updated.push({
        id: trans.id,
        is_parent: true,
        notes: joinNotes(trans.notes, marker),
      });
      categorized.forEach((line, i) => {
        added.push(
          makeChild(trans, {
            amount: -line.amount,
            notes: line.note,
            category: line.category,
            // Keep the item order in the transaction list
            sort_order: (trans.sort_order ?? 0) - i - 1,
          }),
        );
      });
    }
    result.applied.push(trans.id);
  }

  if (updated.length > 0) {
    await batchUpdateTransactions({ added, updated });
  }
  return result;
}
