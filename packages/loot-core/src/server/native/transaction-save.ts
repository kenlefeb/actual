// Fork-only (sc-3602, openspec/changes/native-add-transaction D3). The native
// Add transaction sheet's one write: an add or an edit, checked whole in the
// order of D3 before anything is written. app.ts registers it as one undo step
// carrying Swift's token, with the touched rows' state for native/undo.
import * as db from '#server/db';
import { batchUpdateTransactions } from '#server/transactions';
import type { TransactionEntity } from '#types/models';

import type { Touched } from './accounts-writes';
import { readLimit } from './limits';
import { nativeRefusal } from './refusal';
import {
  evaluateDraft,
  readDraft,
  touchedSet,
  transactionDigest,
} from './transaction-form';

const NAME = 'native/transaction-save';
const marks = (ids: unknown[]) => ids.map(() => '?').join(',');

function invalid(text: string, codes: string[] = []) {
  return nativeRefusal('invalid-draft', `${NAME}: ${text}`, codes);
}

type StoredRow = {
  id: string;
  acct: string;
  tombstone: number;
  isChild: number;
  date: number;
  amount: number;
  description: string | null;
  category: string | null;
};

const dateRepr = (date: string) => parseInt(date.replace(/-/g, ''), 10);

/**
 * The payee a draft names: its id, a live payee of the same name ignoring
 * case, or a new name to create. A blank name, one too long or one equal to a
 * transfer payee's refuses (D3).
 */
async function resolvePayee(payee: string | null, payeeName: string | null) {
  if (payee !== null || payeeName === null) {
    return { id: payee, create: null };
  }
  const name = payeeName.trim();
  if (name === '') throw invalid('a new payee needs a name');
  if (name.length > (await readLimit('payee-name-max-length'))) {
    throw invalid('payee name too long', ['payee-too-long']);
  }
  const found = await db.all<{ id: string; transfer_acct: string | null }>(
    'SELECT id, transfer_acct FROM payees WHERE tombstone = 0 AND LOWER(name) = LOWER(?) ORDER BY id',
    [name],
  );
  if (found.some(p => p.transfer_acct)) {
    throw invalid("a payee name may not be a transfer payee's");
  }
  return found.length
    ? { id: found[0].id, create: null }
    : { id: null, create: name };
}

/** The live split rows and partners an edit can touch, read before the write. */
async function readEditRows(id: string) {
  const ids = await touchedSet(id);
  return db.all<{
    id: string;
    is_child: number;
    parent_id: string | null;
    reconciled: number;
  }>(
    `SELECT t.id, t.isChild AS is_child, t.parent_id,
       (t.reconciled = 1 OR IFNULL(p.reconciled, 0) = 1) AS reconciled
     FROM transactions t LEFT JOIN transactions p ON p.id = t.parent_id AND t.isChild = 1 AND p.tombstone = 0
     WHERE t.tombstone = 0 AND t.id IN (${marks(ids)})`,
    ids,
  );
}

/** A payee id, or a name's live payee, as the first save of a repeat stored it. */
async function storedPayee(payee: string | null, payeeName: string | null) {
  if (payee !== null || payeeName === null || payeeName.trim() === '') {
    return payee;
  }
  return (
    (
      await db.first<{ id: string }>(
        'SELECT id FROM payees WHERE tombstone = 0 AND transfer_acct IS NULL AND LOWER(name) = LOWER(?)',
        [payeeName.trim()],
      )
    )?.id ?? null
  );
}

export async function transactionSave(
  args: {
    draft: unknown;
    previewDigest?: string | null;
    digest?: string;
    undoToken: string;
    confirmedReconciled?: boolean;
  },
  touched?: Touched,
): Promise<{ id: string }> {
  // 1. Shape. An add's split ids are refused by readDraft
  const {
    draft: input,
    previewDigest,
    digest,
    undoToken,
    confirmedReconciled,
  } = args ?? ({} as typeof args);
  if (typeof undoToken !== 'string' || !undoToken) {
    throw invalid('a native write needs its undo token');
  }
  if (previewDigest != null && typeof previewDigest !== 'string') {
    throw invalid('previewDigest must be text');
  }
  const draft = readDraft(NAME, input);
  const isAdd = draft.newId !== undefined;
  if (!isAdd && draft.id === undefined) {
    throw invalid('an add needs its new id, an edit its id');
  }

  // 3, for an edit: the digest, the open account and the split ids, before
  // anything else is read
  let before: Awaited<ReturnType<typeof readEditRows>> = [];
  if (!isAdd) {
    const id = draft.id as string;
    if (
      typeof digest !== 'string' ||
      digest !== (await transactionDigest(id))
    ) {
      throw nativeRefusal(
        'changed-since',
        `${NAME}: the transaction changed since the form was read`,
      );
    }
    // As the form read: a live top-level row of an open account
    const parent = await db.first<{ id: string }>(
      `SELECT t.id FROM transactions t JOIN accounts a ON a.id = t.acct
       WHERE t.id = ? AND t.tombstone = 0 AND t.isChild = 0 AND a.closed = 0 AND a.tombstone = 0`,
      [id],
    );
    if (!parent) {
      throw nativeRefusal('not-found', `${NAME}: no such transaction`);
    }
    before = await readEditRows(id);
    // A child id names one of this transaction's own live children, once
    const own = new Set(
      before.filter(r => r.is_child && r.parent_id === id).map(r => r.id),
    );
    const named = draft.splits.flatMap(s => (s.id === undefined ? [] : [s.id]));
    if (
      named.some(childId => !own.has(childId)) ||
      new Set(named).size !== named.length
    ) {
      throw invalid("a split row is not one of this transaction's own");
    }
  }

  // 4. The result exactly as the preview computes it: one rules run on the
  // input for an add, none for an edit. Nothing is written by it.
  const evaluated = await evaluateDraft(NAME, draft);
  const { result } = evaluated;

  // 2. A repeat of an add: the row itself is the durable record
  if (isAdd) {
    const existing = await db.first<StoredRow>(
      'SELECT id, acct, tombstone, isChild, date, amount, description, category FROM transactions WHERE id = ?',
      [draft.newId as string],
    );
    if (existing) {
      if (existing.tombstone) {
        throw nativeRefusal(
          'changed-since',
          `${NAME}: that transaction was undone or deleted`,
        );
      }
      const children = await db.first<{ n: number }>(
        'SELECT COUNT(*) AS n FROM transactions WHERE tombstone = 0 AND isChild = 1 AND parent_id = ?',
        [existing.id],
      );
      if (
        existing.isChild ||
        existing.acct !== result.account ||
        existing.date !== dateRepr(result.date) ||
        existing.amount !== result.amount ||
        existing.description !==
          (await storedPayee(result.payee, result.payeeName)) ||
        existing.category !== (result.splits.length ? null : result.category) ||
        (children?.n ?? 0) !== result.splits.length
      ) {
        throw invalid('that id is another transaction');
      }
      return { id: existing.id };
    }
  }

  // 4. The result must be what the person saw: the preview's digest, or,
  // with none, the input itself. A rule that deletes the row is never stored.
  const stale =
    evaluated.deleted ||
    (typeof previewDigest === 'string'
      ? previewDigest !== evaluated.resultDigest
      : evaluated.changed);
  if (stale) {
    throw nativeRefusal(
      'preview-stale',
      `${NAME}: rules changed the result since it was shown`,
    );
  }

  // 6. The preview's checks, on the result
  const codes = [
    ...new Set(Object.values(evaluated.errors).map(e => e.code)),
  ].sort();
  if (codes.length > 0) throw invalid('invalid draft', codes);
  const payee = await resolvePayee(result.payee, result.payeeName);

  // 5 and 7. The touched rows that exist now: the parent, its children kept
  // and removed, and their transfer partners. A row counts as reconciled when
  // it, or its split parent, is.
  if (confirmedReconciled !== true && before.some(r => r.reconciled)) {
    throw nativeRefusal(
      'needs-confirmed-reconciled',
      `${NAME}: a reconciled row needs confirmedReconciled to be true`,
    );
  }

  // The write: the payee, then one batch of only the digest's fields (D2,
  // Security on PR 453), so nothing else a rule or the page sets is stored
  let payeeId = payee.id;
  if (payee.create !== null) {
    payeeId = await db.insertPayee({ name: payee.create });
  }
  const id = (isAdd ? draft.newId : draft.id) as string;
  const isSplit = result.splits.length > 0;
  const parent = {
    id,
    account: result.account,
    date: result.date,
    payee: payeeId,
    category: isSplit ? null : result.category,
    notes: result.notes,
    cleared: result.cleared,
    amount: result.amount as number,
    is_parent: isSplit,
    ...(isAdd &&
      evaluated.schedule !== null && { schedule: evaluated.schedule }),
  } as TransactionEntity;
  const children = result.splits.map(
    (s, i) =>
      ({
        id: (isAdd ? undefined : draft.splits[i]?.id) ?? crypto.randomUUID(),
        account: result.account,
        date: result.date,
        payee: s.payee ?? payeeId,
        category: s.category,
        notes: s.notes,
        cleared: result.cleared,
        amount: s.amount as number,
        is_child: true,
        parent_id: id,
      }) as TransactionEntity,
  );
  const learnCategories =
    (
      await db.first<{ value: string | null }>(
        "SELECT value FROM preferences WHERE id = 'learn-categories'",
      )
    )?.value !== 'false';

  if (isAdd) {
    await batchUpdateTransactions({
      added: [parent, ...children],
      learnCategories,
    });
  } else {
    const existing = new Set(
      before.filter(r => r.is_child && r.parent_id === id).map(r => r.id),
    );
    const kept = new Set(children.map(c => c.id));
    await batchUpdateTransactions({
      added: children.filter(c => !existing.has(c.id)),
      updated: [parent, ...children.filter(c => existing.has(c.id))],
      deleted: [...existing].filter(c => !kept.has(c)).map(c => ({ id: c })),
      learnCategories,
    });
  }

  // For native/undo: every row before and after, partners old and new
  touched?.transactions.push(
    ...before.map(r => r.id),
    ...(await touchedSet(id)),
  );
  return { id };
}
