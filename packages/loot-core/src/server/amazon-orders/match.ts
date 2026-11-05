import {
  DEFAULT_WINDOW,
  matchCharges,
} from '#server/charge-matching/match-charges';
import type { ChargeToMatch } from '#server/charge-matching/match-charges';
import * as db from '#server/db';
import * as monthUtils from '#shared/months';

import { hasAnyOrderMarker, hasOrderMarker } from './marker';
import type { AmazonCharge, AmazonChargeReview } from './types';

const { daysBefore: DAYS_BEFORE, daysAfter: DAYS_AFTER } = DEFAULT_WINDOW;
const HINTS = ['amazon', 'amzn'];

function toChargeToMatch(charge: AmazonCharge): ChargeToMatch {
  return {
    amount: -charge.amount,
    date: charge.shipDate,
    hints: HINTS,
  };
}

type FlagRow = {
  amount: number;
  date: number;
  notes: string | null;
  is_parent: number;
};

// Split parents and marked transactions aren't candidates, so a second small
// query finds them for the "Already itemized" and "Already split" flags.
async function findItemizedOrSplit(charges: AmazonCharge[]) {
  if (charges.length === 0) {
    return [];
  }
  const dates = charges.map(c => c.shipDate).sort();
  const amounts = [...new Set(charges.map(c => -c.amount))];
  const rows = await db.all<FlagRow>(
    `SELECT t.amount, t.date, t.notes, t.is_parent
       FROM v_transactions_internal_alive t
       JOIN accounts a ON a.id = t.account
      WHERE a.offbudget = 0 AND a.tombstone = 0 AND t.is_child = 0
        AND (t.is_parent = 1 OR t.notes LIKE '%order-details?orderID=%')
        AND t.amount IN (${amounts.map(() => '?').join(', ')})
        AND t.date >= ? AND t.date <= ?`,
    [
      ...amounts,
      db.toDateRepr(monthUtils.subDays(dates[0], DAYS_BEFORE)),
      db.toDateRepr(monthUtils.addDays(dates.at(-1) as string, DAYS_AFTER)),
    ],
  );
  return rows.map(row => ({ ...row, date: db.fromDateRepr(row.date) }));
}

export async function matchAmazonCharges(
  charges: AmazonCharge[],
): Promise<AmazonChargeReview[]> {
  const flagged = await findItemizedOrSplit(charges);
  const inWindow = (charge: AmazonCharge) =>
    flagged.filter(
      row =>
        row.amount === -charge.amount &&
        row.date >= monthUtils.subDays(charge.shipDate, DAYS_BEFORE) &&
        row.date <= monthUtils.addDays(charge.shipDate, DAYS_AFTER),
    );

  const statuses = charges.map(charge => {
    if (charge.amount <= 0) {
      return 'not-a-charge' as const;
    }
    const rows = inWindow(charge);
    if (rows.some(row => hasOrderMarker(row.notes, charge.orderId))) {
      return 'already-itemized' as const;
    }
    if (charge.giftCardOrPoints) {
      return 'gift-card-or-points' as const;
    }
    if (rows.some(row => row.is_parent === 1)) {
      return 'already-split' as const;
    }
    return null;
  });

  const open = charges.filter((_, i) => statuses[i] === null);
  const matches = await matchCharges(open.map(toChargeToMatch), {
    exclude: t => hasAnyOrderMarker(t.notes),
  });

  let next = 0;
  return charges.map((charge, i) => {
    const status = statuses[i];
    if (status === 'not-a-charge') {
      return {
        charge,
        status: 'unmatched' as const,
        reason: status,
        transaction: null,
        candidates: [],
      };
    }
    if (status !== null) {
      return {
        charge,
        status,
        reason: null,
        transaction: null,
        candidates: [],
      };
    }
    const match = matches[next++];
    return {
      charge,
      status: match.status,
      reason: null,
      transaction: match.transaction,
      candidates:
        match.status === 'ambiguous'
          ? match.candidates.map(c => c.transaction)
          : [],
    };
  });
}
