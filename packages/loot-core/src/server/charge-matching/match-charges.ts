// Matches outside charges (an Amazon shipment, later a receipt) to existing
// bank transactions by exact amount and a date window, across every
// on-budget account. It knows nothing about where the charges came from.
import * as db from '#server/db';
import * as monthUtils from '#shared/months';

export type ChargeToMatch = {
  // The transaction amount to look for, signed like the transaction
  amount: number;
  date: string;
  daysBefore: number;
  daysAfter: number;
  // Lowercase text that, found in a payee or imported payee, ranks a
  // candidate higher. A hint never filters.
  hints: string[];
};

export type CandidateTransaction = {
  id: string;
  account: string;
  accountName: string;
  date: string;
  amount: number;
  payeeName: string | null;
  importedPayee: string | null;
  notes: string | null;
  category: string | null;
  cleared: boolean;
  reconciled: boolean;
};

export type CandidateReason = 'exact-amount' | 'in-date-window' | 'payee-hint';

export type RankedCandidate = {
  transaction: CandidateTransaction;
  reasons: CandidateReason[];
  daysFromDate: number;
};

export type ChargeMatch = {
  status: 'matched' | 'ambiguous' | 'unmatched';
  transaction: CandidateTransaction | null;
  // Best first
  candidates: RankedCandidate[];
};

type Row = {
  id: string;
  account: string;
  account_name: string;
  date: number;
  amount: number;
  payee_name: string | null;
  imported_payee: string | null;
  notes: string | null;
  category: string | null;
  cleared: number;
  reconciled: number;
};

function toCandidate(row: Row): CandidateTransaction {
  return {
    id: row.id,
    account: row.account,
    accountName: row.account_name,
    date: db.fromDateRepr(row.date),
    amount: row.amount,
    payeeName: row.payee_name,
    importedPayee: row.imported_payee,
    notes: row.notes,
    category: row.category,
    cleared: row.cleared === 1,
    reconciled: row.reconciled === 1,
  };
}

function windowOf(charge: ChargeToMatch) {
  return {
    from: monthUtils.subDays(charge.date, charge.daysBefore),
    to: monthUtils.addDays(charge.date, charge.daysAfter),
  };
}

// On-budget, alive, unsplit, non-transfer transactions that could belong to
// any of the charges: one query for the whole batch.
async function findCandidates(
  charges: ChargeToMatch[],
): Promise<CandidateTransaction[]> {
  if (charges.length === 0) {
    return [];
  }
  const windows = charges.map(windowOf);
  const from = windows.map(w => w.from).sort()[0];
  const to = windows
    .map(w => w.to)
    .sort()
    .at(-1) as string;
  const amounts = [...new Set(charges.map(c => c.amount))];

  const rows = await db.all<Row>(
    `SELECT t.id, t.account, a.name AS account_name, t.date, t.amount,
            p.name AS payee_name, t.imported_payee, t.notes, t.category,
            t.cleared, t.reconciled
       FROM v_transactions_internal_alive t
       JOIN accounts a ON a.id = t.account
       LEFT JOIN payees p ON p.id = t.payee
      WHERE a.offbudget = 0 AND a.tombstone = 0
        AND t.is_parent = 0 AND t.is_child = 0
        AND t.transfer_id IS NULL
        AND t.amount IN (${amounts.map(() => '?').join(', ')})
        AND t.date >= ? AND t.date <= ?`,
    [...amounts, db.toDateRepr(from), db.toDateRepr(to)],
  );
  return rows.map(toCandidate);
}

function rank(
  charge: ChargeToMatch,
  transactions: CandidateTransaction[],
): RankedCandidate[] {
  const { from, to } = windowOf(charge);
  return transactions
    .filter(t => t.amount === charge.amount && t.date >= from && t.date <= to)
    .map(transaction => {
      const payee =
        `${transaction.payeeName ?? ''} ${transaction.importedPayee ?? ''}`.toLowerCase();
      const reasons: CandidateReason[] = ['exact-amount', 'in-date-window'];
      if (charge.hints.some(hint => payee.includes(hint))) {
        reasons.push('payee-hint');
      }
      return {
        transaction,
        reasons,
        daysFromDate: Math.abs(
          monthUtils.differenceInCalendarDays(transaction.date, charge.date),
        ),
      };
    })
    .sort(compare);
}

function hasHint(c: RankedCandidate) {
  return c.reasons.includes('payee-hint');
}

function compare(a: RankedCandidate, b: RankedCandidate): number {
  return (
    Number(hasHint(b)) - Number(hasHint(a)) || a.daysFromDate - b.daysFromDate
  );
}

/**
 * Ranks each charge's candidates, then gives each charge its best free
 * candidate in charge order. A charge whose two best candidates rank
 * equally, or that has an equal claim to the same best transaction as
 * another charge, is ambiguous, and nothing is assigned among them.
 */
export async function matchCharges(
  charges: ChargeToMatch[],
  { exclude }: { exclude?: (t: CandidateTransaction) => boolean } = {},
): Promise<ChargeMatch[]> {
  const transactions = (await findCandidates(charges)).filter(
    t => !exclude?.(t),
  );
  const ranked = charges.map(charge => rank(charge, transactions));
  const results: ChargeMatch[] = ranked.map(candidates => ({
    status: candidates.length === 0 ? 'unmatched' : 'ambiguous',
    transaction: null,
    candidates,
  }));
  const taken = new Set<string>();
  const decided = new Set<number>();

  for (let i = 0; i < charges.length; i++) {
    if (decided.has(i)) {
      continue;
    }
    decided.add(i);
    const free = ranked[i].filter(c => !taken.has(c.transaction.id));
    if (free.length === 0) {
      continue;
    }
    const [best, next] = free;
    if (next && compare(best, next) === 0) {
      continue;
    }
    const rivals = ranked
      .map((candidates, j) =>
        j !== i &&
        !decided.has(j) &&
        candidates.some(
          c =>
            c.transaction.id === best.transaction.id && compare(c, best) === 0,
        )
          ? j
          : -1,
      )
      .filter(j => j !== -1);
    if (rivals.length > 0) {
      taken.add(best.transaction.id);
      rivals.forEach(j => decided.add(j));
      continue;
    }
    taken.add(best.transaction.id);
    results[i] = {
      status: 'matched',
      transaction: best.transaction,
      candidates: ranked[i],
    };
  }
  return results;
}
