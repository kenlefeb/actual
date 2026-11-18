// Fork-only (sc-3602, openspec/changes/native-add-transaction D3). The native
// Add transaction sheet's one write: an add or an edit, checked whole in the
// order of D3 before anything is written. app.ts registers it as one undo step
// carrying Swift's token, with the touched rows' state for native/undo.
import * as db from '#server/db';
import { batchUpdateTransactions } from '#server/transactions';
import type { TransactionEntity } from '#types/models';

import type { Touched } from './accounts-writes';
import { readLimit } from './reconcile-lock';
import { nativeRefusal } from './refusal';
import {
  evaluateDraft,
  readDraft,
  touchedSet,
  transactionDigest,
} from './transaction-form';
import type { NativeDraft } from './transaction-form';

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
async function resolvePayee(draft: NativeDraft) {
  if (draft.payee !== null || draft.payeeName === null) {
    return { id: draft.payee, create: null };
  }
  const name = draft.payeeName.trim();
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

export async function transactionSave(
  args: {
    draft: unknown;
    digest?: string;
    undoToken: string;
    confirmedReconciled?: boolean;
  },
  touched?: Touched,
): Promise<{ id: string }> {
  // 1. Shape
  const {
    draft: input,
    digest,
    undoToken,
    confirmedReconciled,
  } = args ?? ({} as typeof args);
  if (typeof undoToken !== 'string' || !undoToken) {
    throw invalid('a native write needs its undo token');
  }
  const draft = readDraft(NAME, input);
  const isAdd = draft.newId !== undefined;
  if (!isAdd && draft.id === undefined) {
    throw invalid('an add needs its new id, an edit its id');
  }
  const payee = await resolvePayee(draft);
  if (payee.id !== null) {
    draft.payee = payee.id;
    draft.payeeName = null;
  }

  // 2. A repeat of an add: the row itself is the durable record
  if (isAdd) {
    const existing = await db.first<StoredRow>(
      'SELECT id, acct, tombstone, isChild, date, amount, description, category FROM transactions WHERE id = ?',
      [draft.newId],
    );
    if (existing) {
      if (existing.tombstone) {
        throw nativeRefusal(
          'changed-since',
          `${NAME}: that transaction was undone or deleted`,
        );
      }
      const evaluated = await evaluateDraft(NAME, draft, null, 'save');
      const children = await db.first<{ n: number }>(
        'SELECT COUNT(*) AS n FROM transactions WHERE tombstone = 0 AND isChild = 1 AND parent_id = ?',
        [existing.id],
      );
      // A name the first save created is that payee now
      const payeeId =
        payee.create !== null
          ? ((
              await db.first<{ id: string }>(
                'SELECT id FROM payees WHERE tombstone = 0 AND transfer_acct IS NULL AND LOWER(name) = LOWER(?)',
                [payee.create],
              )
            )?.id ?? null)
          : draft.payee;
      if (
        existing.isChild ||
        existing.acct !== draft.account ||
        existing.date !== dateRepr(draft.date) ||
        existing.amount !== evaluated.amount ||
        existing.description !== payeeId ||
        existing.category !== (draft.splits.length ? null : draft.category) ||
        (children?.n ?? 0) !== draft.splits.length
      ) {
        throw invalid('that id is another transaction');
      }
      return { id: existing.id };
    }
  }

  // 3. An edit's digest, recomputed over every row it can touch
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
    const parent = await db.first<{ id: string }>(
      'SELECT id FROM transactions WHERE id = ? AND tombstone = 0 AND isChild = 0',
      [id],
    );
    if (!parent) {
      throw nativeRefusal('not-found', `${NAME}: no such transaction`);
    }
    before = await readEditRows(id);
    const own = new Set(
      before.filter(r => r.id === id || r.parent_id === id).map(r => r.id),
    );
    if (draft.splits.some(s => s.id !== undefined && !own.has(s.id))) {
      throw invalid('a split row belongs to another transaction');
    }
  }

  // 4. Rules first, for an add; then 6, the preview's checks on the result
  const evaluated = await evaluateDraft(
    NAME,
    draft,
    null,
    isAdd ? 'save' : 'preview',
  );
  if (evaluated.stale) {
    throw nativeRefusal(
      'preview-stale',
      `${NAME}: rules changed the draft since it was shown`,
    );
  }
  const codes = [
    ...new Set(Object.values(evaluated.errors).map(e => e.code)),
  ].sort();
  if (codes.length > 0) throw invalid('invalid draft', codes);
  const amount = evaluated.amount as number;
  const splitAmounts = evaluated.splitAmounts as number[];

  // 5 and 7. The touched rows that exist now: the parent, its children kept
  // and removed, and their transfer partners. A row counts as reconciled when
  // it, or its split parent, is.
  if (confirmedReconciled !== true && before.some(r => r.reconciled)) {
    throw nativeRefusal(
      'needs-confirmed-reconciled',
      `${NAME}: a reconciled row needs confirmedReconciled to be true`,
    );
  }

  // The write: the payee, then one batch
  let payeeId = draft.payee;
  if (payee.create !== null) {
    payeeId = await db.insertPayee({ name: payee.create });
  }
  const id = (isAdd ? draft.newId : draft.id) as string;
  const isSplit = draft.splits.length > 0;
  const parent = {
    id,
    account: draft.account,
    date: draft.date,
    payee: payeeId,
    category: isSplit ? null : draft.category,
    notes: draft.notes,
    cleared: draft.cleared,
    amount,
    is_parent: isSplit,
  } as TransactionEntity;
  const children = draft.splits.map(
    (s, i) =>
      ({
        id: s.id ?? crypto.randomUUID(),
        account: draft.account,
        date: draft.date,
        payee: s.payee ?? payeeId,
        category: s.category,
        notes: s.notes,
        cleared: draft.cleared,
        amount: splitAmounts[i],
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
      before.filter(r => r.parent_id === id).map(r => r.id),
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
