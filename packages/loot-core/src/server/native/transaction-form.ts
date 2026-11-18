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
    (value.newId !== undefined && value.id !== undefined) ||
    // An add's children are all new: the engine creates their ids (PR 453)
    (value.id === undefined &&
      (value.splits as NativeDraftSplit[] | undefined)?.some(
        s => s.id !== undefined,
      ))
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
  // The budget's currency symbols, or null when no currency is set (D2)
  currency: string[] | null = null,
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
    const found =
      symbols === 0
        ? currency
          ? currency.find(s => text.startsWith(s, at))
          : /^\p{Sc}$/u.test(text[at] ?? '')
            ? text[at]
            : undefined
        : undefined;
    if (found) {
      symbols++;
      at += found.length;
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
  currency: string[] | null,
): Amount {
  if (text.trim() === '') return { error: 'amount-required' };
  if (text.length > MAX_AMOUNT_TEXT) return { error: 'amount-invalid' };
  const canonical = canonicalAmount(text, format, currency);
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

async function readFormat() {
  const prefs = await db.all<{ id: string; value: string | null }>(
    "SELECT id, value FROM preferences WHERE id IN ('defaultCurrencyCode', 'numberFormat', 'hideFraction')",
  );
  const pref = (id: string) => prefs.find(p => p.id === id)?.value ?? undefined;
  const code = pref('defaultCurrencyCode') ?? '';
  const currency = getCurrency(code);
  // D2: with a currency set, only its symbol (and its final sign alone, `$`
  // for `A$`) is ignored next to a number; with none, any one symbol is
  const last = currency.symbol.slice(-1);
  const symbols = code
    ? [
        currency.symbol,
        ...(currency.symbol.length > 1 && /\p{Sc}/u.test(last) ? [last] : []),
      ].filter(s => s !== '')
    : null;
  const format = parseNumberFormat({
    format: pref('numberFormat'),
    hideFraction: pref('hideFraction'),
  });
  return {
    places: currency.decimalPlaces,
    symbols,
    format: format.format,
    separator: getNumberFormat({ format: format.format }).decimalSeparator,
  };
}

// The fields a rule can set on the parent, by the entity's field name
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

export type NativeResultSplit = {
  payee: string | null;
  // A payee name a rule set that no payee has yet; the save creates it
  payeeName: string | null;
  category: string | null;
  notes: string;
  inflow: boolean;
  amount: number | null;
  // The engine's formatting of `amount`, so Swift copies it without arithmetic
  amountText: string | null;
};

export type NativeResult = NativeResultSplit & {
  account: string;
  date: string;
  cleared: boolean;
  splits: NativeResultSplit[];
};

export type NativeSuggestionValue = {
  id?: string;
  name?: string;
  text?: string;
  flag?: boolean;
  amount?: number;
  amountText?: string;
};

export type NativePreview = {
  // The person's input after one run of the rules, with amounts evaluated
  result: NativeResult;
  // What a save of this result stores, hashed in the engine (D2)
  resultDigest: string;
  // Fields a rule set that the person never touched
  ruleFields: string[];
  // Hand-set fields a rule would set differently, with the rule's value
  suggestions: {
    field: UserField;
    row: number;
    value: NativeSuggestionValue;
  }[];
  remaining: number | null;
  // By field; only amount-invalid carries a detail, the budget's decimal
  // separator, never what was typed (PR 450)
  errors: Record<
    string,
    { code: FieldErrorCode; detail?: { decimalSeparator: string } }
  >;
};

export type NativeEvaluated = NativePreview & {
  // A rule changed a rule-settable field of the input
  changed: boolean;
  // A rule's result deletes the transaction
  deleted: boolean;
  // The schedule a rule linked, which the digest and a save carry
  schedule: string | null;
};

/** A row's payee as the digest carries it: an id, an unresolved name, or none. */
function digestPayee(payee: string | null, name: string | null) {
  if (payee) return { id: payee };
  if (name !== null && name.trim() !== '') return { name: name.trim() };
  return null;
}

/**
 * D2: the rows a save would store, parent then children in `splits` order,
 * each with exactly the sorted keys account, amount, category, cleared,
 * date, notes, payee and schedule, hashed by the helper the edit digest uses.
 */
export async function resultDigest(
  result: NativeResult,
  schedule: string | null,
) {
  const row = (r: NativeResultSplit) => ({
    account: result.account,
    amount: r.amount,
    category: r.category,
    cleared: result.cleared,
    date: result.date,
    notes: r.notes === '' ? null : r.notes,
    // A child with no payee of its own is stored with the parent's
    payee:
      r.payee || r.payeeName
        ? digestPayee(r.payee, r.payeeName)
        : digestPayee(result.payee, result.payeeName),
    schedule,
  });
  return sha256(JSON.stringify([row(result), ...result.splits.map(row)]));
}

const sameValue = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/**
 * The preview's work, shared with the save (D2, D3): the amounts evaluated,
 * one rules run on the input for a new draft keeping every field in
 * `userFields`, the field errors on the result, and its digest. Writes
 * nothing and creates no payee.
 */
export async function evaluateDraft(
  name: string,
  draft: NativeDraft,
): Promise<NativeEvaluated> {
  const format = await readFormat();
  const splitMax = await readLimit('transaction-split-max-children');
  const errors: Record<string, FieldErrorCode> = {};
  const user = new Set<string>(draft.userFields);

  // A new name equal to a live payee's is that payee (D3), never a new one
  if (draft.payee === null && draft.payeeName !== null) {
    const found = await payeeByName(draft.payeeName);
    if (found) {
      draft.payee = found;
      draft.payeeName = null;
    }
  }

  const evaluate = (text: string, inflow: boolean) =>
    evaluateAmount(text, inflow, format.places, format.format, format.symbols);
  const textOf = (amount: number | null) =>
    amount === null
      ? null
      : amountText(amount, format.places, format.separator);
  const parentAmount = evaluate(draft.amountText, draft.inflow);
  // Over the limit, no child is evaluated or looked up (PR 450)
  const overLimit = draft.splits.length > splitMax;
  const childAmounts = overLimit
    ? []
    : draft.splits.map(s => evaluate(s.amountText, s.inflow));
  const valueOf = (a: Amount | undefined) =>
    a && 'amount' in a ? a.amount : null;

  // The evaluated input, in the result's shape
  const input: NativeResult = {
    account: draft.account,
    date: draft.date,
    payee: draft.payee,
    payeeName: draft.payeeName,
    category: draft.category,
    notes: draft.notes,
    cleared: draft.cleared,
    inflow: draft.inflow,
    amount: valueOf(parentAmount),
    amountText: textOf(valueOf(parentAmount)),
    splits: draft.splits.map((s, i) => ({
      payee: s.payee ?? null,
      payeeName: null,
      category: s.category,
      notes: s.notes,
      inflow: s.inflow,
      amount: valueOf(childAmounts[i]),
      amountText: textOf(valueOf(childAmounts[i])),
    })),
  };
  const result: NativeResult = {
    ...input,
    splits: input.splits.map(s => ({ ...s })),
  };
  let resultAmounts = { parent: parentAmount, children: childAmounts };
  const ruleFields = new Set<string>();
  const suggestions: NativePreview['suggestions'] = [];
  let deleted = false;
  let schedule: string | null = null;

  // Rules run once, on a new draft only (D2), and not on one that cannot be dated
  if (draft.id === undefined && validDate(draft.date) && !overLimit) {
    const parentId = draft.newId ?? 'temp';
    const before = {
      id: parentId,
      account: input.account || null,
      date: input.date,
      payee: input.payee,
      category: input.category,
      notes: input.notes,
      cleared: input.cleared,
      amount: input.amount ?? 0,
      ...(input.splits.length > 0 && {
        is_parent: true,
        subtransactions: input.splits.map((s, i) => ({
          id: `${parentId}/${i}`,
          account: input.account || null,
          date: input.date,
          payee: s.payee ?? input.payee,
          category: s.category,
          notes: s.notes,
          amount: s.amount ?? 0,
          is_child: true,
          parent_id: parentId,
        })),
      }),
    } as TransactionEntity;
    // One run, with every hand-set field protected after each rule, so no
    // rule sees a value the transaction will never have (PR 447 review). A
    // read: a payee a rule names stays a name.
    const entityField = (field: string) =>
      field === 'splits' ? 'subtransactions' : field;
    const run = async (protect: string[]) =>
      (await runRules(before, null, {
        resolvePayeeNames: false,
        protectedFields: protect.map(entityField),
      })) as TransactionEntity & { payee_name?: string; tombstone?: boolean };
    // The rule's value for each parent field, in the result's terms
    const ruledOf = (after: TransactionEntity & { payee_name?: string }) => {
      const named = after.payee === 'new';
      return {
        named,
        name: named ? (after.payee_name ?? null) : null,
        value: {
          account: after.account ?? '',
          date: after.date,
          payee: named ? null : (after.payee ?? null),
          category: after.category ?? null,
          notes: after.notes ?? '',
          cleared: Boolean(after.cleared),
          amount: after.amount,
        } as Record<RuleField, unknown>,
      };
    };
    const differs = (ruled: ReturnType<typeof ruledOf>, field: RuleField) =>
      field === 'payee'
        ? !sameValue(ruled.value.payee, input.payee) ||
          (ruled.named && !sameValue(ruled.name, input.payeeName))
        : field === 'amount'
          ? input.amount !== null && ruled.value.amount !== input.amount
          : !sameValue(ruled.value[field], input[field]);
    // Whether a rule run changed the children
    const childrenDiffer = (after: TransactionEntity) => {
      const ruledSplits = after.subtransactions ?? [];
      return (
        ruledSplits.length !== input.splits.length ||
        ruledSplits.some(
          (c, i) =>
            !sameValue(
              c.payee ?? input.payee,
              input.splits[i].payee ?? input.payee,
            ) ||
            !sameValue(c.category, input.splits[i].category) ||
            !sameValue(c.notes ?? '', input.splits[i].notes) ||
            c.amount !== (input.splits[i].amount ?? 0),
        )
      );
    };

    const handSet = [...draft.userFields];
    const after = await run(handSet);
    deleted = Boolean(after.tombstone);
    schedule = after.schedule ?? null;
    const ruled = ruledOf(after);
    for (const field of RULE_FIELDS) {
      if (user.has(field) || !differs(ruled, field)) continue;
      ruleFields.add(field);
      if (field === 'payee') {
        result.payee = ruled.value.payee as string | null;
        result.payeeName = ruled.name;
      } else if (field === 'amount') {
        const amount = ruled.value.amount as number;
        result.amount = amount;
        result.inflow = amount > 0;
        result.amountText = textOf(amount);
        resultAmounts = { ...resultAmounts, parent: { amount } };
      } else {
        (result as Record<string, unknown>)[field] = ruled.value[field];
      }
    }
    // The children a rule set, unless the person set them by hand
    if (!user.has('splits') && childrenDiffer(after)) {
      ruleFields.add('splits');
      result.splits = (after.subtransactions ?? []).map(c => ({
        payee: c.payee === 'new' ? null : (c.payee ?? null),
        payeeName: null,
        category: c.category ?? null,
        notes: c.notes ?? '',
        inflow: (c.amount ?? 0) > 0,
        amount: c.amount ?? 0,
        amountText: textOf(c.amount ?? 0),
      }));
      resultAmounts = {
        ...resultAmounts,
        children: result.splits.map(c => ({ amount: c.amount as number })),
      };
    }

    // Suggestions (D2): one run with nothing protected finds the candidates;
    // each is confirmed by a run freeing only that field, on every row at
    // once. At most one run per hand-set field; none when nothing is hand-set.
    if (handSet.length > 0) {
      const free = await run([]);
      const freeRuled = ruledOf(free);
      for (const field of handSet) {
        const candidate =
          field === 'splits'
            ? childrenDiffer(free)
            : differs(freeRuled, field as RuleField);
        if (!candidate) continue;
        const confirmed = await run(handSet.filter(f => f !== field));
        if (field === 'splits') {
          if (childrenDiffer(confirmed)) {
            suggestions.push({ field, row: 0, value: {} });
          }
          continue;
        }
        const value = ruledOf(confirmed);
        if (differs(value, field as RuleField)) {
          suggestions.push({
            field,
            row: 0,
            value: { [field]: value.value[field as RuleField] },
          });
        }
      }
    }
  }
  await describeSuggestions(suggestions, textOf);

  // Field errors, on the result
  const lookups = await readLookups(
    {
      ...draft,
      payee: result.payee,
      splits: result.splits.map((s, i) => ({
        ...(draft.splits[i]?.id !== undefined && { id: draft.splits[i].id }),
        payee: s.payee,
        category: s.category,
        notes: s.notes,
        inflow: s.inflow,
        amountText: '',
      })),
    },
    !overLimit,
  );
  if ('error' in resultAmounts.parent) {
    errors.amount = resultAmounts.parent.error;
  }
  if (!validDate(result.date)) errors.date = 'date-invalid';
  const account = result.account ? lookups.accounts.get(result.account) : null;
  if (!result.account) {
    errors.account = 'account-required';
  } else if (!account || account.closed) {
    errors.account = 'account-closed';
  }
  const notesMax = await readLimit('transaction-notes-max-length');
  const payeeNameMax = await readLimit('payee-name-max-length');

  // A transfer payee's account: closed, or on budget; unknown ids refuse
  const transferOf = (payee: string | null | undefined) => {
    if (!payee) return { closed: false, onBudget: false, same: false };
    const found = lookups.payees.get(payee);
    if (!found) {
      throw nativeRefusal('invalid-draft', `${name}: no such payee`);
    }
    if (!found.transfer_acct) {
      return { closed: false, onBudget: false, same: false };
    }
    const target = lookups.accounts.get(found.transfer_acct);
    return {
      closed: !target || Boolean(target.closed),
      onBudget: Boolean(target && !target.offbudget),
      // As the web refuses it: a transfer to the transaction's own account
      same: found.transfer_acct === result.account,
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

  const parentTransfer = transferError(result.payee);
  if (parentTransfer) errors.payee = parentTransfer;
  if (
    result.payee === null &&
    result.payeeName !== null &&
    result.payeeName.trim().length > payeeNameMax
  ) {
    errors.payee = 'payee-too-long';
  }
  const parentCategory =
    result.splits.length > 0 && result.category !== null
      ? 'category-not-allowed'
      : categoryError(result.category, result.payee, draft.id);
  if (parentCategory) errors.category = parentCategory;
  if (result.notes.length > notesMax) errors.notes = 'notes-too-long';

  let remaining: number | null = null;
  if (overLimit) {
    errors.splits = 'split-limit';
  } else if (result.splits.length > 0) {
    result.splits.forEach((s, i) => {
      const at = `splits.${i}`;
      const own = resultAmounts.children[i];
      if (own && 'error' in own) errors[`${at}.amount`] = own.error;
      const transfer = transferError(s.payee);
      if (transfer) errors[`${at}.payee`] = transfer;
      // A child keeps its stored hidden category only on an edit
      const rowId = draft.id === undefined ? undefined : draft.splits[i]?.id;
      const category = categoryError(
        s.category,
        s.payee ?? result.payee,
        rowId,
      );
      if (category) errors[`${at}.category`] = category;
      if (s.notes.length > notesMax) errors[`${at}.notes`] = 'notes-too-long';
    });
    const amounts = result.splits.map(s => s.amount);
    if (result.amount !== null && amounts.every(a => a !== null)) {
      remaining =
        result.amount - (amounts as number[]).reduce((sum, a) => sum + a, 0);
      if (remaining !== 0) errors.splits = 'split-mismatch';
    }
  }

  return {
    result,
    resultDigest: await resultDigest(result, schedule),
    ruleFields: [...ruleFields].sort(),
    suggestions,
    remaining,
    errors: Object.fromEntries(
      Object.entries(errors).map(([field, code]) => [
        field,
        code === 'amount-invalid'
          ? { code, detail: { decimalSeparator: format.separator } }
          : { code },
      ]),
    ),
    changed: ruleFields.size > 0,
    deleted,
    schedule,
  };
}

/** Each suggestion's value as the engine shows it: ids with names, text, a flag or an amount. */
async function describeSuggestions(
  suggestions: NativePreview['suggestions'],
  textOf: (amount: number | null) => string | null,
) {
  for (const suggestion of suggestions) {
    const raw = (suggestion.value as Record<string, unknown>)[suggestion.field];
    if (suggestion.field === 'splits') continue;
    let value: NativeSuggestionValue = {};
    if (
      suggestion.field === 'category' ||
      suggestion.field === 'account' ||
      suggestion.field === 'payee'
    ) {
      const table =
        suggestion.field === 'category'
          ? 'categories'
          : suggestion.field === 'account'
            ? 'accounts'
            : 'payees';
      const id = typeof raw === 'string' && raw !== '' ? raw : null;
      const found = id
        ? await db.first<{ name: string }>(
            `SELECT name FROM ${table} WHERE id = ?`,
            [id],
          )
        : null;
      value = id ? { id, ...(found && { name: found.name }) } : {};
    } else if (suggestion.field === 'cleared') {
      value = { flag: Boolean(raw) };
    } else if (suggestion.field === 'amount') {
      value = {
        amount: raw as number,
        amountText: textOf(Math.abs(raw as number)) ?? '',
      };
    } else {
      value = { text: String(raw ?? '') };
    }
    suggestion.value = value;
  }
}

/**
 * The preview (D2): one rules run on the person's input, the result with
 * amounts evaluated, its digest, the fields a rule set, the rule's values
 * for hand-set fields, the split remainder and field errors. No side effects.
 */
export async function transactionPreview({
  draft: input,
}: {
  draft: unknown;
}): Promise<NativePreview> {
  const name = 'native/transaction-preview';
  const {
    changed: _changed,
    deleted: _deleted,
    schedule: _schedule,
    ...preview
  } = await evaluateDraft(name, readDraft(name, input));
  return preview;
}
