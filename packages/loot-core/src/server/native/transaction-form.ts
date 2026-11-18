// Fork-only (sc-3602, openspec/changes/native-add-transaction D1 and D2).
// The native Add transaction sheet's reads: the form, the payee search and
// the preview. Every amount, rule and check is loot-core's; Swift only shows
// them. The preview writes nothing and never creates a payee. The contract is
// transaction-form.test.ts and its fixtures.
import * as db from '#server/db';
import { fromDateRepr } from '#server/models';
import { runRules } from '#server/transactions/transaction-rules';
import { evalArithmetic } from '#shared/arithmetic';
import { getCurrency } from '#shared/currencies';
import * as monthUtils from '#shared/months';
import {
  getChangedValues,
  getNumberFormat,
  parseNumberFormat,
  setNumberFormat,
} from '#shared/util';
import type { NumberFormats } from '#shared/util';
import type { TransactionEntity } from '#types/models';

import { readTouchedState } from './accounts-writes';
import { readLimit } from './limits';
import { nativeRefusal } from './refusal';

// The per-field codes (fixtures/transaction-field-errors.json). Kept apart
// from the call refusals so Swift never mistakes one for the other (D2).
export const FIELD_ERROR_CODES = [
  'amount-invalid',
  'amount-required',
  'account-required',
  'account-closed',
  'category-not-allowed',
  'category-unknown',
  'date-invalid',
  'split-mismatch',
  'split-limit',
  'payee-too-long',
  'notes-too-long',
  // Added 2026-11-18 (PR 442)
  'transfer-same-account',
  // Added 2026-11-18 (PR 444)
  'category-hidden',
  // Added 2026-11-18 (PR 450): a leading minus or a result below zero
  'amount-negative',
] as const;

export type FieldErrorCode = (typeof FIELD_ERROR_CODES)[number];

const ALIVE = 'v_transactions_internal_alive';
const marks = (ids: unknown[]) => ids.map(() => '?').join(',');

async function sha256(text: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Every row a save of `id` can touch: the parent, its live children and every
 * transfer partner of any of them, ids sorted (D1).
 */
export async function touchedSet(id: string) {
  const own = await db.all<{ id: string; transfer_id: string | null }>(
    `SELECT id, transfer_id FROM ${ALIVE} WHERE id = ? OR (is_child = 1 AND parent_id = ?)`,
    [id, id],
  );
  const ids = new Set(own.map(r => r.id));
  for (const r of own) if (r.transfer_id) ids.add(r.transfer_id);
  return [...ids].sort();
}

/** The edit digest: the SHA-256 of the shared undo state over the touched set (D1). */
export async function transactionDigest(id: string) {
  const state = await readTouchedState({
    transactions: await touchedSet(id),
    accounts: [],
  });
  return sha256(JSON.stringify(state));
}

export type NativeFormRow = {
  id: string;
  date: string;
  payee: string | null;
  payeeName: string | null;
  category: string | null;
  categoryName: string | null;
  notes: string;
  cleared: boolean;
  reconciled: boolean;
  amount: number;
  transferAccount: { id: string; name: string } | null;
  transferAccountClosed: boolean;
  // The transfer partner's own fields, so Reload can show a change made only
  // on the other side (D1); null for a row that is not a transfer
  partner: {
    id: string;
    account: string;
    date: string;
    amount: number;
    notes: string;
    cleared: boolean;
    reconciled: boolean;
  } | null;
};

export type NativeFormTransaction = NativeFormRow & {
  account: string;
  schedule: { id: string; name: string | null } | null;
  attachments: string[];
  splits: NativeFormRow[];
  digest: string;
};

export type NativeTransactionForm = {
  accounts: {
    id: string;
    name: string;
    offbudget: boolean;
    // The id the Transfer state puts in the draft's payee
    transferPayee: string | null;
  }[];
  categoryGroups: {
    id: string;
    name: string;
    isIncome: boolean;
    categories: { id: string; name: string; hidden: boolean }[];
  }[];
  defaults: { account: string | null; date: string; cleared: boolean } | null;
  transaction: NativeFormTransaction | null;
};

type DbFormRow = {
  id: string;
  account: string;
  date: number;
  payee: string | null;
  payee_name: string | null;
  category: string | null;
  category_name: string | null;
  notes: string | null;
  cleared: number;
  reconciled: number;
  amount: number;
  is_child: number;
  schedule: string | null;
  transfer_account: string | null;
  transfer_account_name: string | null;
  transfer_account_closed: number | null;
  partner_id: string | null;
  partner_account: string;
  partner_date: number;
  partner_amount: number;
  partner_notes: string | null;
  partner_cleared: number;
  partner_reconciled: number;
};

function formRow(r: DbFormRow): NativeFormRow {
  return {
    id: r.id,
    date: fromDateRepr(r.date),
    payee: r.payee,
    payeeName: r.payee_name,
    category: r.category,
    categoryName: r.category_name,
    notes: r.notes ?? '',
    cleared: Boolean(r.cleared),
    reconciled: Boolean(r.reconciled),
    amount: r.amount,
    transferAccount: r.transfer_account
      ? { id: r.transfer_account, name: r.transfer_account_name ?? '' }
      : null,
    transferAccountClosed: Boolean(r.transfer_account_closed),
    partner: r.partner_id
      ? {
          id: r.partner_id,
          account: r.partner_account,
          date: fromDateRepr(r.partner_date),
          amount: r.partner_amount,
          notes: r.partner_notes ?? '',
          cleared: Boolean(r.partner_cleared),
          reconciled: Boolean(r.partner_reconciled),
        }
      : null,
  };
}

/** The form in one read (D1): an add's defaults, or a whole transaction with its digest. */
export async function transactionForm({
  id,
  account_id,
}: {
  id?: string;
  account_id?: string;
}): Promise<NativeTransactionForm> {
  const accounts = (
    await db.all<{
      id: string;
      name: string;
      offbudget: number;
      transfer_payee: string | null;
    }>(
      // Each account's live transfer payee, in the same read (D1, D8a)
      `SELECT a.id, a.name, a.offbudget,
         (SELECT p.id FROM payees p WHERE p.transfer_acct = a.id AND p.tombstone = 0 ORDER BY p.id LIMIT 1) AS transfer_payee
       FROM accounts a WHERE a.tombstone = 0 AND a.closed = 0 ORDER BY a.offbudget, a.sort_order, a.name`,
    )
  ).map(a => ({
    id: a.id,
    name: a.name,
    offbudget: Boolean(a.offbudget),
    transferPayee: a.transfer_payee,
  }));
  // Hidden ones too, marked, so an edit can keep one (PR 444)
  const groups = await db.all<{
    id: string;
    name: string;
    is_income: number;
    hidden: number;
  }>(
    'SELECT id, name, is_income, hidden FROM category_groups WHERE tombstone = 0 ORDER BY is_income, sort_order, id',
  );
  const categories = await db.all<{
    id: string;
    name: string;
    cat_group: string;
    hidden: number;
  }>(
    'SELECT id, name, cat_group, hidden FROM categories WHERE tombstone = 0 ORDER BY sort_order, id',
  );
  const categoryGroups = groups.map(g => ({
    id: g.id,
    name: g.name,
    isIncome: Boolean(g.is_income),
    categories: categories
      .filter(c => c.cat_group === g.id)
      .map(c => ({
        id: c.id,
        name: c.name,
        // A hidden group's categories count as hidden
        hidden: Boolean(c.hidden || g.hidden),
      })),
  }));

  if (id === undefined || id === null) {
    return {
      accounts,
      categoryGroups,
      defaults: {
        account: accounts.some(a => a.id === account_id)
          ? (account_id as string)
          : null,
        date: monthUtils.currentDay(),
        // The web form's default (TransactionEdit: the `cleared` parameter)
        cleared: false,
      },
      transaction: null,
    };
  }

  const select = `SELECT t.id, t.account, t.date, t.payee, p.name AS payee_name, t.category, c.name AS category_name,
      t.notes, t.cleared, t.reconciled, t.amount, t.is_child, t.schedule,
      ta.id AS transfer_account, ta.name AS transfer_account_name,
      (ta.closed = 1 OR ta.tombstone = 1) AS transfer_account_closed,
      pt.id AS partner_id, pt.acct AS partner_account, pt.date AS partner_date, pt.amount AS partner_amount,
      pt.notes AS partner_notes, pt.cleared AS partner_cleared, pt.reconciled AS partner_reconciled
    FROM ${ALIVE} t
    LEFT JOIN payees p ON p.id = t.payee
    LEFT JOIN categories c ON c.id = t.category
    LEFT JOIN accounts ta ON ta.id = p.transfer_acct
    LEFT JOIN transactions pt ON pt.id = t.transfer_id AND pt.tombstone = 0`;
  const parent =
    typeof id === 'string'
      ? await db.first<DbFormRow>(
          `${select} JOIN accounts a ON a.id = t.account
           WHERE t.id = ? AND t.is_child = 0 AND a.closed = 0 AND a.tombstone = 0`,
          [id],
        )
      : null;
  if (!parent) {
    throw nativeRefusal(
      'not-found',
      'native/transaction-form: no such transaction',
    );
  }
  const children = await db.all<DbFormRow>(
    `${select} WHERE t.is_child = 1 AND t.parent_id = ? ORDER BY t.sort_order DESC, t.id`,
    [id],
  );
  const schedule = parent.schedule
    ? await db.first<{ id: string; name: string | null }>(
        'SELECT id, name FROM schedules WHERE id = ? AND tombstone = 0',
        [parent.schedule],
      )
    : null;
  const attachments = await db.all<{ name: string }>(
    'SELECT name FROM transaction_attachments WHERE tombstone = 0 AND transaction_id = ? ORDER BY created_at, id',
    [id],
  );
  return {
    accounts,
    categoryGroups,
    defaults: null,
    transaction: {
      ...formRow(parent),
      account: parent.account,
      schedule: schedule ?? null,
      attachments: attachments.map(a => a.name),
      splits: children.map(formRow),
      digest: await transactionDigest(id),
    },
  };
}

const escapeLike = (text: string) =>
  `%${text.replace(/[\\%_]/g, c => `\\${c}`)}%`;

/** The payee picker's search (D1): live, non-transfer payees, favourites first. */
export async function payeesSearch({ search }: { search?: string | null }) {
  const max = await readLimit('payee-search-max-length');
  const text = search ?? '';
  if (typeof text !== 'string' || text.length > max) {
    throw new Error(
      `native/payees: search must be text of at most ${max} characters`,
    );
  }
  const limit = await readLimit('payee-picker-max-results');
  const found = await db.all<{ id: string; name: string; favorite: number }>(
    `SELECT id, name, favorite FROM payees
     WHERE tombstone = 0 AND transfer_acct IS NULL AND name LIKE ? ESCAPE '\\'
     ORDER BY favorite DESC, LOWER(name), id LIMIT ?`,
    [escapeLike(text), limit],
  );
  return {
    payees: found.map(p => ({
      id: p.id,
      name: p.name,
      favorite: Boolean(p.favorite),
    })),
  };
}

// The draft (D2): a trust boundary, so only these keys and types pass
export const USER_FIELDS = [
  'account',
  'date',
  'payee',
  'category',
  'notes',
  'cleared',
  'amount',
  'splits',
] as const;
type UserField = (typeof USER_FIELDS)[number];

export type NativeDraftSplit = {
  id?: string;
  payee?: string | null;
  category: string | null;
  notes: string;
  inflow: boolean;
  amountText: string;
};

export type NativeDraft = {
  newId?: string;
  id?: string;
  account: string;
  date: string;
  payee: string | null;
  payeeName: string | null;
  category: string | null;
  notes: string;
  cleared: boolean;
  inflow: boolean;
  amountText: string;
  splits: NativeDraftSplit[];
  userFields: UserField[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isString = (v: unknown) => typeof v === 'string';
const isStringOrNull = (v: unknown) => v === null || typeof v === 'string';
const isBoolean = (v: unknown) => typeof v === 'boolean';

const DRAFT_KEYS: Record<string, (v: unknown) => boolean> = {
  newId: v => typeof v === 'string' && UUID.test(v),
  id: isString,
  account: isString,
  date: isString,
  payee: isStringOrNull,
  payeeName: isStringOrNull,
  category: isStringOrNull,
  notes: isString,
  cleared: isBoolean,
  inflow: isBoolean,
  amountText: isString,
  splits: v => Array.isArray(v) && v.every(isSplit),
  userFields: v =>
    Array.isArray(v) &&
    v.every(f => (USER_FIELDS as readonly unknown[]).includes(f)),
};

const SPLIT_KEYS: Record<string, (v: unknown) => boolean> = {
  id: isString,
  payee: isStringOrNull,
  category: isStringOrNull,
  notes: isString,
  inflow: isBoolean,
  amountText: isString,
};

function hasOnly(
  value: unknown,
  keys: Record<string, (v: unknown) => boolean>,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, v]) => Object.hasOwn(keys, key) && keys[key](v),
    )
  );
}

function isSplit(value: unknown) {
  return hasOnly(value, SPLIT_KEYS);
}

/** The draft with its defaults, or `[native:invalid-draft]` (D2). Never echoes the input. */
export function readDraft(name: string, value: unknown): NativeDraft {
  if (
    !hasOnly(value, DRAFT_KEYS) ||
    (value.newId !== undefined && value.id !== undefined)
  ) {
    throw nativeRefusal('invalid-draft', `${name}: invalid draft`);
  }
  const v = value as Partial<NativeDraft>;
  return {
    ...(v.newId !== undefined && { newId: v.newId }),
    ...(v.id !== undefined && { id: v.id }),
    account: v.account ?? '',
    date: v.date ?? '',
    payee: v.payee ?? null,
    payeeName: v.payeeName ?? null,
    category: v.category ?? null,
    notes: v.notes ?? '',
    cleared: v.cleared ?? false,
    inflow: v.inflow ?? false,
    amountText: v.amountText ?? '',
    splits: (v.splits ?? []).map(s => ({
      ...(s.id !== undefined && { id: s.id }),
      payee: s.payee ?? null,
      category: s.category ?? null,
      notes: s.notes ?? '',
      inflow: s.inflow ?? false,
      amountText: s.amountText ?? '',
    })),
    userFields: [...new Set(v.userFields ?? [])],
  };
}

// D2: input validation, not a tunable limit
const MAX_AMOUNT_TEXT = 100;

type Amount = { amount: number } | { error: FieldErrorCode };

// The amount grammar (design D2, spec "Amount numbers follow the budget's
// number format" and "Amount expressions use a closed set of operators").
// The separators are the web's own, from getNumberFormat; the grouping
// positions, operators and signs are this grammar's. Deliberately stricter
// than the web's evalArithmetic: no amount is silently regrouped, truncated
// or reversed.
function separators(format: NumberFormats) {
  const { thousandsSeparator, decimalSeparator } = getNumberFormat({ format });
  const grouping = [thousandsSeparator];
  // Characters people type for the same grouping
  if (format === 'space-comma') grouping.push(' ', ' ', ' ');
  if (format === 'apostrophe-dot') grouping.push("'", "'");
  return { grouping, decimal: decimalSeparator };
}

const OPERATORS: Record<string, string> = {
  '+': '+',
  '-': '-',
  '−': '-',
  '*': '*',
  '×': '*',
  '/': '/',
  '÷': '/',
};

type Canonical = { text: string } | { error: FieldErrorCode };

/**
 * Reads amount text by the grammar. Returns the plain arithmetic text
 * evalArithmetic reads (`1200.5+99.5`), `amount-negative` for a leading minus
 * on otherwise good text, or `amount-invalid`.
 */
export function canonicalAmount(
  input: string,
  format: NumberFormats,
): Canonical {
  const { grouping, decimal } = separators(format);
  const indian = format === 'comma-dot-in';
  let text = input.trim();
  let negative = false;
  if (text[0] === '-' || text[0] === '−') {
    negative = true;
    text = text.slice(1);
  }
  let at = 0;
  let out = '';
  let symbols = 0;
  const isDigit = (c: string | undefined) =>
    c !== undefined && c >= '0' && c <= '9';
  const spaces = () => {
    while (text[at] === ' ') at++;
  };
  // One currency symbol next to a number, before or after it, with optional space
  const symbol = () => {
    const start = at;
    spaces();
    if (/^\p{Sc}$/u.test(text[at] ?? '') && symbols === 0) {
      symbols++;
      at++;
      spaces();
      return true;
    }
    at = start;
    return false;
  };
  const number = () => {
    const groups = [''];
    while (
      isDigit(text[at]) ||
      (grouping.includes(text[at]) &&
        isDigit(text[at - 1]) &&
        isDigit(text[at + 1]))
    ) {
      if (isDigit(text[at])) groups[groups.length - 1] += text[at];
      else groups.push('');
      at++;
    }
    const [first, ...rest] = groups;
    if (rest.length > 0) {
      const last = rest[rest.length - 1];
      const middle = rest.slice(0, -1);
      const ok = indian
        ? first.length <= 2 &&
          last.length === 3 &&
          middle.every(g => g.length === 2)
        : first.length <= 3 && rest.every(g => g.length === 3);
      if (!ok) return false;
    }
    let digits = groups.join('');
    if (text[at] === decimal && isDigit(text[at + 1])) {
      at++;
      let fraction = '';
      while (isDigit(text[at])) fraction += text[at++];
      digits = `${digits || '0'}.${fraction}`;
    } else if (text[at] === decimal && digits !== '') {
      // A trailing decimal separator reads as no fraction, as on the web (PR 453)
      at++;
    }
    if (digits === '') return false;
    out += digits;
    return true;
  };
  const operand = (): boolean => {
    spaces();
    if (text[at] === '(') {
      at++;
      out += '(';
      if (!expression()) return false;
      spaces();
      if (text[at] !== ')') return false;
      at++;
      out += ')';
      return true;
    }
    const before = symbol();
    if (!number()) return false;
    if (!before) symbol();
    return true;
  };
  const expression = (): boolean => {
    if (!operand()) return false;
    for (;;) {
      spaces();
      const op = OPERATORS[text[at] ?? ''];
      if (!op) return true;
      at++;
      out += op;
      if (!operand()) return false;
    }
  };
  if (!expression() || at !== text.length) return { error: 'amount-invalid' };
  return negative ? { error: 'amount-negative' } : { text: out };
}

/** One amount text in the budget's number format, as signed integer minor units. */
function evaluateAmount(
  text: string,
  inflow: boolean,
  places: number,
  format: NumberFormats,
): Amount {
  if (text.trim() === '') return { error: 'amount-required' };
  if (text.length > MAX_AMOUNT_TEXT) return { error: 'amount-invalid' };
  const canonical = canonicalAmount(text, format);
  if ('error' in canonical) return canonical;
  // The canonical text has '.' as its only separator, which evalArithmetic
  // reads as a decimal in the default format
  const previous = getNumberFormat().value;
  setNumberFormat({ format: 'comma-dot', hideFraction: false });
  let value: number | null;
  try {
    value = evalArithmetic(canonical.text, null);
  } finally {
    // shortcut: restores the format only; the server never sets hideFraction
    setNumberFormat({ format: previous, hideFraction: false });
  }
  if (value === null || !Number.isFinite(value)) {
    return { error: 'amount-invalid' };
  }
  // The sign comes from the control, never from the text
  if (value < 0) return { error: 'amount-negative' };
  const scaled = value * 10 ** places;
  const minor = Math.round(scaled);
  // A whole number of minor units, allowing binary rounding (0.1 + 0.2)
  if (Math.abs(scaled - minor) > 1e-6 || !Number.isSafeInteger(minor)) {
    return { error: 'amount-invalid' };
  }
  return { amount: inflow ? minor : -minor || 0 };
}

/** Amount text for an amount a rule set, in the budget's decimal separator. */
function amountText(amount: number, places: number, separator: string) {
  const digits = String(Math.abs(amount)).padStart(places + 1, '0');
  return places > 0
    ? `${digits.slice(0, -places)}${separator}${digits.slice(-places)}`
    : digits;
}

function validDate(date: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    date < '1900-01-01' ||
    date > '2999-12-31'
  ) {
    return false;
  }
  // A real calendar day: 2026-02-30 does not round-trip
  const day = new Date(`${date}T00:00:00Z`);
  return (
    !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === date
  );
}

// An empty value from the rules' point of view (the web's isEmptyRuleTarget)
const isEmpty = (value: unknown) =>
  value == null ||
  value === '' ||
  value === 0 ||
  value === false ||
  (Array.isArray(value) && value.length === 0);

/**
 * The web's shouldApplyRuleChange (desktop-client
 * components/transactions/table/utils.ts), without the cleared list, which
 * the caller handles: a rule fills an empty field, and an append or prepend
 * notes rule extends the note once.
 */
function shouldApplyRuleChange(field: string, current: unknown, next: unknown) {
  if (isEmpty(current)) return true;
  if (
    field !== 'notes' ||
    typeof current !== 'string' ||
    typeof next !== 'string' ||
    next === current
  ) {
    return false;
  }
  const index = next.indexOf(current);
  if (index === -1) return false;
  const prepended = next.slice(0, index);
  const appended = next.slice(index + current.length);
  return !(
    (prepended === '' || current.startsWith(prepended)) &&
    (appended === '' || current.endsWith(appended))
  );
}

// The draft fields rules can set, by the entity's field name
const RULE_FIELDS = [
  'account',
  'date',
  'payee',
  'category',
  'notes',
  'cleared',
  'amount',
] as const;
type RuleField = (typeof RULE_FIELDS)[number];
// Fields a rule may have filled that a later preview can still show as the rule's
const PROBED_FIELDS = ['category', 'notes', 'cleared'] as const;

type Lookups = {
  accounts: Map<string, { offbudget: number; closed: number }>;
  payees: Map<string, { transfer_acct: string | null }>;
  // Live categories: whether each is hidden, its own flag or its group's
  categories: Map<string, boolean>;
  // An edit's stored category per row id, so a row can keep a hidden one
  stored: Map<string, string | null>;
};

async function readLookups(
  draft: NativeDraft,
  withSplits: boolean,
): Promise<Lookups> {
  const accounts = new Map(
    (
      await db.all<{
        id: string;
        offbudget: number;
        closed: number;
        tombstone: number;
      }>('SELECT id, offbudget, closed, tombstone FROM accounts')
    ).map(a => [
      a.id,
      { offbudget: a.offbudget, closed: a.closed || a.tombstone },
    ]),
  );
  const splits = withSplits ? draft.splits : [];
  const payeeIds = [draft.payee, ...splits.map(s => s.payee)].filter(
    (p): p is string => typeof p === 'string',
  );
  const payees = new Map(
    payeeIds.length
      ? (
          await db.all<{ id: string; transfer_acct: string | null }>(
            `SELECT id, transfer_acct FROM payees WHERE tombstone = 0 AND id IN (${marks(payeeIds)})`,
            payeeIds,
          )
        ).map(p => [p.id, p])
      : [],
  );
  const categories = new Map(
    (
      await db.all<{ id: string; hidden: number }>(
        `SELECT c.id, (c.hidden = 1 OR IFNULL(g.hidden, 0) = 1) AS hidden FROM categories c
         LEFT JOIN category_groups g ON g.id = c.cat_group WHERE c.tombstone = 0`,
      )
    ).map(c => [c.id, Boolean(c.hidden)]),
  );
  const rowIds =
    draft.id === undefined
      ? []
      : [draft.id, ...splits.flatMap(s => (s.id ? [s.id] : []))];
  const stored = new Map(
    rowIds.length
      ? (
          await db.all<{ id: string; category: string | null }>(
            `SELECT id, category FROM ${ALIVE} WHERE id IN (${marks(rowIds)})`,
            rowIds,
          )
        ).map(r => [r.id, r.category])
      : [],
  );
  return { accounts, payees, categories, stored };
}

/** A live payee whose name equals `name` ignoring case and outer spaces, else null (D3). */
async function payeeByName(name: string) {
  return (
    (
      await db.first<{ id: string }>(
        'SELECT id FROM payees WHERE tombstone = 0 AND transfer_acct IS NULL AND LOWER(name) = LOWER(?) ORDER BY id LIMIT 1',
        [name.trim()],
      )
    )?.id ?? null
  );
}

export type NativePreview = {
  // The draft as the sheet shows it and sends back; the evaluated amounts beside it
  draft: NativeDraft;
  amount: number | null;
  splitAmounts: (number | null)[];
  ruleFields: string[];
  replaced: { field: UserField; value: unknown }[];
  remaining: number | null;
  // By field; only amount-invalid carries a detail, the budget's decimal
  // separator, never what was typed (PR 450)
  errors: Record<
    string,
    { code: FieldErrorCode; detail?: { decimalSeparator: string } }
  >;
};

async function readFormat() {
  const prefs = await db.all<{ id: string; value: string | null }>(
    "SELECT id, value FROM preferences WHERE id IN ('defaultCurrencyCode', 'numberFormat', 'hideFraction')",
  );
  const pref = (id: string) => prefs.find(p => p.id === id)?.value ?? undefined;
  return {
    places: getCurrency(pref('defaultCurrencyCode') ?? '').decimalPlaces,
    ...parseNumberFormat({
      format: pref('numberFormat'),
      hideFraction: pref('hideFraction'),
    }),
  };
}

/** The draft's value for a user field, as Restore puts it back. */
function draftValue(draft: NativeDraft, field: UserField): unknown {
  if (field === 'amount') {
    return { amountText: draft.amountText, inflow: draft.inflow };
  }
  return draft[field];
}

/**
 * The preview (D2): the draft as the web form shows it after a field commit,
 * with amounts evaluated, rules applied to a new draft, the split remainder
 * and field errors. Writes nothing and creates no payee.
 */
export async function transactionPreview({
  draft: input,
  changedField,
}: {
  draft: unknown;
  changedField?: string | null;
}): Promise<NativePreview> {
  const name = 'native/transaction-preview';
  const draft = readDraft(name, input);
  if (
    changedField != null &&
    !(USER_FIELDS as readonly unknown[]).includes(changedField)
  ) {
    throw nativeRefusal('invalid-draft', `${name}: invalid changed field`);
  }
  const format = await readFormat();
  const separator = getNumberFormat({ format: format.format }).decimalSeparator;
  const splitMax = await readLimit('transaction-split-max-children');
  const errors: Record<string, FieldErrorCode> = {};

  // A new name equal to a live payee's is that payee (D3), never a new one
  if (draft.payee === null && draft.payeeName !== null) {
    const found = await payeeByName(draft.payeeName);
    if (found) {
      draft.payee = found;
      draft.payeeName = null;
    }
  }

  let parentAmount = evaluateAmount(
    draft.amountText,
    draft.inflow,
    format.places,
    format.format,
  );
  // Over the limit, no child is evaluated or looked up (PR 450)
  const overLimit = draft.splits.length > splitMax;
  let childAmounts: Amount[] = overLimit
    ? []
    : draft.splits.map(s =>
        evaluateAmount(s.amountText, s.inflow, format.places, format.format),
      );

  const ruleFields = new Set<string>();
  const replaced: NativePreview['replaced'] = [];
  let splitAmounts = childAmounts.map(a => ('amount' in a ? a.amount : null));
  let amount = 'amount' in parentAmount ? parentAmount.amount : null;

  // Rules run only on a new draft (D2), and not on one that cannot be dated
  if (
    draft.id === undefined &&
    validDate(draft.date) &&
    draft.splits.length <= splitMax
  ) {
    const parentId = draft.newId ?? 'temp';
    const entity = (fields: NativeDraft, value: number | null) =>
      ({
        id: parentId,
        account: fields.account || null,
        date: fields.date,
        payee: fields.payee,
        category: fields.category,
        notes: fields.notes,
        cleared: fields.cleared,
        amount: value ?? 0,
        ...(fields.splits.length > 0 && {
          is_parent: true,
          subtransactions: fields.splits.map((s, i) => ({
            id: s.id ?? `${parentId}/${i}`,
            account: fields.account || null,
            date: fields.date,
            payee: s.payee ?? fields.payee,
            category: s.category,
            notes: s.notes,
            amount: splitAmounts[i] ?? 0,
            is_child: true,
            parent_id: parentId,
          })),
        }),
      }) as TransactionEntity;
    const before = entity(draft, amount);
    // A read: a payee a rule names stays a name (PR 447 review)
    const after = (await runRules(before, null, {
      createPayees: false,
    })) as TransactionEntity & { payee_name?: string };
    const diff = getChangedValues(before, after) ?? {};
    const user = new Set<string>(draft.userFields);
    const payeeChange = changedField === 'payee';

    for (const field of RULE_FIELDS) {
      if (!Object.hasOwn(diff, field)) continue;
      const current = before[field];
      const next = after[field];
      if (user.has(field)) {
        // A field the person cleared stays empty; one they set yields only to a payee change
        if (!payeeChange || isEmpty(current)) continue;
        replaced.push({ field, value: draftValue(draft, field) });
      } else if (!payeeChange && !shouldApplyRuleChange(field, current, next)) {
        continue;
      }
      ruleFields.add(field);
      if (field === 'amount') {
        amount = next as number;
        draft.inflow = amount > 0;
        draft.amountText = amountText(amount, format.places, separator);
        parentAmount = { amount };
      } else if (field === 'payee') {
        // A name no payee has yet: the save creates it
        const named = next === 'new';
        draft.payee = named ? null : (next as string | null);
        draft.payeeName = named ? (after.payee_name ?? null) : null;
      } else {
        (draft as Record<string, unknown>)[field] = next;
      }
    }

    // Splits as the web form takes them: a split rule makes the children of
    // a draft without any, unless the person removed them; on an existing
    // split, the edited field's rule value goes down to each child
    // (propagateRuleChangeToSubtransactions)
    const ruleSplits = after.subtransactions ?? [];
    if (draft.splits.length === 0 && ruleSplits.length > 0) {
      if (!user.has('splits')) {
        draft.splits = ruleSplits.map(s => ({
          payee: s.payee ?? null,
          category: s.category ?? null,
          notes: s.notes ?? '',
          inflow: (s.amount ?? 0) > 0,
          amountText: amountText(s.amount ?? 0, format.places, separator),
        }));
        splitAmounts = ruleSplits.map(s => s.amount ?? 0);
        childAmounts = splitAmounts.map(a => ({ amount: a as number }));
        ruleFields.add('splits');
      }
    } else if (
      changedField &&
      ['payee', 'category', 'notes'].includes(changedField) &&
      !(user.has(changedField) && isEmpty(before[changedField as RuleField]))
    ) {
      const field = changedField as 'payee' | 'category' | 'notes';
      draft.splits = draft.splits.map((s, i) => {
        const value = ruleSplits[i]?.[field];
        return value == null ? s : { ...s, [field]: value };
      });
    }

    // Fields that still hold a rule's value from an earlier preview: a rule
    // that, with them emptied, sets them to what the draft shows
    const probed = PROBED_FIELDS.filter(
      f =>
        !ruleFields.has(f) &&
        !user.has(f) &&
        f !== changedField &&
        !isEmpty(draft[f]),
    );
    if (probed.length > 0) {
      const emptied = { ...draft };
      for (const f of probed) {
        (emptied as Record<string, unknown>)[f] = f === 'cleared' ? false : '';
        if (f === 'category') emptied.category = null;
      }
      const again = (await runRules(entity(emptied, amount), null, {
        createPayees: false,
      })) as TransactionEntity;
      for (const f of probed) {
        if (again[f] === draft[f]) ruleFields.add(f);
      }
    }
  }

  // Field errors, on the draft as it now stands
  const lookups = await readLookups(draft, !overLimit);
  if ('error' in parentAmount) errors.amount = parentAmount.error;
  if (!validDate(draft.date)) errors.date = 'date-invalid';
  const account = draft.account ? lookups.accounts.get(draft.account) : null;
  if (!draft.account) {
    errors.account = 'account-required';
  } else if (!account || account.closed) {
    errors.account = 'account-closed';
  }
  const notesMax = await readLimit('transaction-notes-max-length');
  const payeeNameMax = await readLimit('payee-name-max-length');

  // A transfer payee's account: closed, or on budget; unknown ids refuse
  const transferOf = (payee: string | null | undefined) => {
    if (!payee) return { closed: false, onBudget: false };
    const found = lookups.payees.get(payee);
    if (!found) {
      throw nativeRefusal('invalid-draft', `${name}: no such payee`);
    }
    if (!found.transfer_acct) return { closed: false, onBudget: false };
    const target = lookups.accounts.get(found.transfer_acct);
    return {
      closed: !target || Boolean(target.closed),
      onBudget: Boolean(target && !target.offbudget),
      // As the web refuses it: a transfer to the transaction's own account
      same: found.transfer_acct === draft.account,
    };
  };
  const transferError = (payee: string | null | undefined) => {
    const transfer = transferOf(payee);
    if (transfer.closed) return 'account-closed';
    if (transfer.same) return 'transfer-same-account';
    return null;
  };
  const categoryError = (
    category: string | null,
    payee: string | null | undefined,
    rowId?: string,
  ): FieldErrorCode | null => {
    if (category === null) return null;
    if (!lookups.categories.has(category)) return 'category-unknown';
    // A hidden category only stays where it already is (PR 444)
    if (
      lookups.categories.get(category) &&
      (rowId === undefined || lookups.stored.get(rowId) !== category)
    ) {
      return 'category-hidden';
    }
    if (account?.offbudget) return 'category-not-allowed';
    if (account && transferOf(payee).onBudget) return 'category-not-allowed';
    return null;
  };

  const parentTransfer = transferError(draft.payee);
  if (parentTransfer) errors.payee = parentTransfer;
  if (
    draft.payee === null &&
    draft.payeeName !== null &&
    draft.payeeName.trim().length > payeeNameMax
  ) {
    errors.payee = 'payee-too-long';
  }
  const parentCategory =
    draft.splits.length > 0 && draft.category !== null
      ? 'category-not-allowed'
      : categoryError(draft.category, draft.payee, draft.id);
  if (parentCategory) errors.category = parentCategory;
  if (draft.notes.length > notesMax) errors.notes = 'notes-too-long';

  let remaining: number | null = null;
  if (draft.splits.length > splitMax) {
    errors.splits = 'split-limit';
  } else if (draft.splits.length > 0) {
    draft.splits.forEach((s, i) => {
      const at = `splits.${i}`;
      const own = childAmounts[i];
      if (own && 'error' in own) errors[`${at}.amount`] = own.error;
      const transfer = transferError(s.payee);
      if (transfer) errors[`${at}.payee`] = transfer;
      const category = categoryError(s.category, s.payee ?? draft.payee, s.id);
      if (category) errors[`${at}.category`] = category;
      if (s.notes.length > notesMax) errors[`${at}.notes`] = 'notes-too-long';
    });
    if (amount !== null && splitAmounts.every(a => a !== null)) {
      remaining =
        amount - (splitAmounts as number[]).reduce((sum, a) => sum + a, 0);
      if (remaining !== 0) errors.splits = 'split-mismatch';
    }
  }

  return {
    draft,
    amount,
    splitAmounts: draft.splits.map((_, i) => splitAmounts[i] ?? null),
    ruleFields: [...ruleFields].sort(),
    replaced,
    remaining,
    errors: Object.fromEntries(
      Object.entries(errors).map(([field, code]) => [
        field,
        code === 'amount-invalid'
          ? { code, detail: { decimalSeparator: separator } }
          : { code },
      ]),
    ),
  };
}
