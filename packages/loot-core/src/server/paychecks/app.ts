import { v4 as uuidv4 } from 'uuid';

import { createApp } from '#server/app';
import * as db from '#server/db';
import { mutator, runMutator } from '#server/mutators';
import {
  createSchedule,
  deleteSchedule,
  getRuleForSchedule,
  refreshScheduleDateLookup,
  skipNextDate,
  updateSchedule,
} from '#server/schedules/app';
import { updateRule } from '#server/transactions/transaction-rules';
import { undoable } from '#server/undo';
import { isFlagOn } from '#shared/feature-flags';
import * as monthUtils from '#shared/months';
import { computePaycheck, MAX_DEPOSIT_DAYS_EARLY } from '#shared/paychecks';
import { isRelativeDate, toRelativeDay } from '#shared/relative-dates';
import { getScheduleDate } from '#shared/schedule-date-lookup';
import type {
  AccountEntity,
  PaycheckClearingStatus,
  PaycheckDefinition,
  PaycheckEntity,
  PaycheckYearToDate,
  RuleActionEntity,
  RuleConditionEntity,
} from '#types/models';

export type PaychecksHandlers = {
  'paychecks-get': typeof getPaychecks;
  'paycheck-create': typeof createPaycheck;
  'paycheck-update': typeof updatePaycheck;
  'paycheck-delete': typeof deletePaycheck;
  'paycheck-skip-next': typeof skipNextPaycheck;
  'paycheck-year-to-date': typeof getYearToDate;
  'paychecks-clearing-status': typeof getClearingStatus;
  'account-set-business-days': typeof setAccountBusinessDays;
};

export const app = createApp<PaychecksHandlers>();
app.method('paychecks-get', getPaychecks);
app.method('paycheck-create', mutator(undoable(createPaycheck)));
app.method('paycheck-update', mutator(undoable(updatePaycheck)));
app.method('paycheck-delete', mutator(undoable(deletePaycheck)));
// At budget load: record schedules of paychecks saved before the record existed
app.service(() => {
  void runMutator(() => backfillPaycheckSchedules());
  return () => undefined;
});
app.method('paycheck-skip-next', mutator(undoable(skipNextPaycheck)));
app.method('paycheck-year-to-date', getYearToDate);
app.method('paychecks-clearing-status', getClearingStatus);
app.method(
  'account-set-business-days',
  mutator(undoable(setAccountBusinessDays)),
);

// Null for a malformed (e.g. corrupt synced) row, which is skipped
function toPaycheck(row: db.DbPaycheck): PaycheckEntity | null {
  try {
    return {
      id: row.id,
      name: row.name,
      definition: JSON.parse(row.definition) as PaycheckDefinition,
    };
  } catch {
    return null;
  }
}

export async function getPaychecks(): Promise<PaycheckEntity[]> {
  const rows = await db.all<db.DbPaycheck>(
    'SELECT * FROM paychecks WHERE tombstone = 0 ORDER BY name, id',
  );
  return rows.flatMap(row => toPaycheck(row) ?? []);
}

async function getPaycheck(id: PaycheckEntity['id']) {
  const row = await db.first<db.DbPaycheck>(
    'SELECT * FROM paychecks WHERE id = ? AND tombstone = 0',
    [id],
  );
  const paycheck = row && toPaycheck(row);
  if (!paycheck) {
    throw new Error('Paycheck not found');
  }
  return paycheck;
}

async function getAccount(id: AccountEntity['id']) {
  const account = await db.first<db.DbAccount>(
    'SELECT * FROM accounts WHERE id = ? AND tombstone = 0',
    [id],
  );
  if (!account) {
    throw new Error('Account not found');
  }
  return account;
}

async function getTransferPayee(account: AccountEntity['id']) {
  const payee = await db.first<Pick<db.DbPayee, 'id'>>(
    'SELECT id FROM payees WHERE transfer_acct = ? AND tombstone = 0',
    [account],
  );
  if (!payee) {
    throw new Error('Account has no transfer payee');
  }
  return payee.id;
}

const isCents = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0;

// Checks a definition from the client or sync before anything is written
async function validate(
  name: string,
  definition: PaycheckDefinition,
  previous?: PaycheckDefinition,
  { isNewClearingAccount = false } = {},
) {
  if (!name.trim()) {
    throw new Error('A paycheck needs a name');
  }
  const { deductions, deposits } = definition;
  if (!Array.isArray(deductions) || !Array.isArray(deposits)) {
    throw new Error('Invalid paycheck: deductions and deposits are lists');
  }
  if (
    !isCents(definition.grossAmount) ||
    deductions.some(d => !isCents(d.amount)) ||
    deposits.some(d =>
      d.kind === 'percent'
        ? !Number.isFinite(d.value) || d.value < 0 || d.value > 100
        : d.kind === 'fixed'
          ? !isCents(d.value)
          : d.kind !== 'remainder',
    )
  ) {
    throw new Error('Invalid paycheck: amounts must be zero or more');
  }
  const { errors } = computePaycheck(definition);
  if (errors.length > 0) {
    throw new Error(`Invalid paycheck: ${errors.join(', ')}`);
  }
  if (new Set(deposits.map(d => d.id)).size !== deposits.length) {
    throw new Error('Invalid paycheck: duplicate deposit');
  }
  if (new Set(deposits.map(d => d.account)).size !== deposits.length) {
    throw new Error('Each deposit must go to a different account');
  }
  if (deposits.some(d => d.account === definition.clearingAccount)) {
    throw new Error('A deposit cannot go to the clearing account');
  }

  if (!isNewClearingAccount) {
    const clearing = await getAccount(definition.clearingAccount);
    if (clearing.offbudget || clearing.closed) {
      throw new Error('The clearing account must be an open on-budget account');
    }
  }
  for (const { name: deduction, transferAccount } of deductions) {
    if (
      transferAccount &&
      !(await db.first(
        `SELECT a.id FROM accounts a JOIN payees p ON p.transfer_acct = a.id
         WHERE a.id = ? AND a.tombstone = 0 AND p.tombstone = 0`,
        [transferAccount],
      ))
    ) {
      throw new Error(`The transfer account for ${deduction} no longer exists`);
    }
  }
  const names = [name];
  for (const deposit of deposits) {
    const account = await getAccount(deposit.account);
    if (account.closed) {
      throw new Error(`Cannot deposit to closed account ${account.name}`);
    }
    names.push(depositScheduleName(name, account.name));
  }
  if (new Set(names).size !== names.length) {
    throw new Error('Deposit accounts need different names');
  }
  // Names are unique among schedules, so check before writing any of them
  const own = [
    previous?.paySchedule,
    ...(previous?.deposits ?? []).map(d => d.schedule),
  ].filter((id): id is string => !!id);
  const taken = await db.all<{ name: string }>(
    `SELECT name FROM schedules WHERE tombstone = 0 AND name IN (${names
      .map(() => '?')
      .join(', ')}) AND id NOT IN (${own.map(() => '?').join(', ') || "''"})`,
    [...names, ...own],
  );
  if (taken.length > 0) {
    throw new Error(`A schedule named "${taken[0].name}" already exists`);
  }
}

function depositScheduleName(paycheck: string, account: string) {
  return `${paycheck} → ${account}`;
}

async function replaceActions(scheduleId: string, actions: RuleActionEntity[]) {
  const rule = await getRuleForSchedule(scheduleId);
  await updateRule({
    id: rule.id,
    actions: [{ op: 'link-schedule', value: scheduleId }, ...actions],
  });
}

// Creates or updates a schedule and replaces its rule actions
async function writeSchedule(
  id: string | null | undefined,
  fields: { name: string; posts_transaction: boolean },
  conditions: RuleConditionEntity[],
  actions: RuleActionEntity[],
) {
  const exists =
    id != null &&
    (await db.first('SELECT id FROM schedules WHERE id = ? AND tombstone = 0', [
      id,
    ])) != null;
  // A schedule deleted outside the paycheck is recreated
  const scheduleId = exists
    ? // Next dates (and skips) change only when the dates do
      await updateSchedule({ schedule: { id, ...fields }, conditions })
    : await createSchedule({ schedule: fields, conditions });
  await replaceActions(scheduleId, actions);
  return scheduleId;
}

// Records which paycheck generated each schedule. Each device writes its own
// rows, so the record survives an edit on another device that loses this
// paycheck's definition (ADR 2, reconcile-paycheck-schedules).
async function recordGenerated(
  paycheckId: PaycheckEntity['id'],
  scheduleIds: string[],
) {
  for (const id of scheduleIds) {
    const row = await db.first<db.DbPaycheckSchedule>(
      'SELECT * FROM paycheck_schedules WHERE id = ?',
      [id],
    );
    if (!row) {
      await db.insert('paycheck_schedules', { id, paycheck: paycheckId });
    } else if (row.tombstone || row.paycheck !== paycheckId) {
      await db.update('paycheck_schedules', {
        id,
        paycheck: paycheckId,
        tombstone: 0,
      });
    }
  }
}

/**
 * Records the schedules each live paycheck lists, for paychecks saved before
 * the record existed. Idempotent: it writes only what's missing.
 */
// The effective paychecks flag, by the same rule the UI uses (ADR 6)
export async function isPaychecksOn() {
  const rows = await db.all<{ id: string; value: string }>(
    "SELECT id, value FROM preferences WHERE id LIKE 'flags.%'",
  );
  return isFlagOn(
    Object.fromEntries(rows.map(row => [row.id, row.value])),
    'paychecks',
  );
}

export async function backfillPaycheckSchedules() {
  for (const paycheck of await getPaychecks()) {
    const listed = [
      paycheck.definition.paySchedule,
      ...paycheck.definition.deposits.map(d => d.schedule),
    ].filter((id): id is string => !!id);
    await recordGenerated(paycheck.id, listed);
  }
}

function listedSchedules(definition: PaycheckDefinition) {
  return (
    [definition.paySchedule, ...definition.deposits.map(d => d.schedule)]
      // Never null after a save; older or corrupt rows may lack them
      .filter((id): id is string => !!id)
  );
}

/**
 * Makes each paycheck's schedules match its live definition (ADR 2), after
 * edits on two devices merged by last write wins (ADR 3):
 * 1. A schedule a paycheck generated but no live definition lists, or whose
 *    paycheck is deleted, is deleted. Posted transactions stay.
 * 2. A schedule a live definition lists but that is deleted is restored in
 *    place, keeping its id and links; one that is missing is recreated.
 *    Deleting first frees the name a recreated schedule needs.
 * Schedules no paycheck generated are never touched. Idempotent.
 */
export async function reconcilePaycheckSchedules() {
  const listedBy = new Map(
    (await getPaychecks()).flatMap(paycheck =>
      listedSchedules(paycheck.definition).map(id => [id, paycheck.id]),
    ),
  );
  const mapped = await db.all<{
    id: string;
    paycheck: string;
    active: number | null;
  }>(
    `SELECT m.id, m.paycheck, s.id IS NOT NULL AND s.tombstone = 0 AS active
       FROM paycheck_schedules m LEFT JOIN schedules s ON s.id = m.id
      WHERE m.tombstone = 0`,
  );
  for (const { id, paycheck, active } of mapped) {
    if (listedBy.get(id) === paycheck) {
      continue;
    }
    if (active) {
      await deleteSchedule({ id });
    }
    await forgetGenerated(id);
  }

  for (const paycheck of await getPaychecks()) {
    let regenerate = paycheck.definition.deposits.some(d => !d.schedule);
    for (const id of listedSchedules(paycheck.definition)) {
      const row = await db.first<{ tombstone: number; rule: string }>(
        'SELECT tombstone, rule FROM schedules WHERE id = ?',
        [id],
      );
      if (!row) {
        regenerate = true;
      } else if (row.tombstone) {
        await db.update('rules', { id: row.rule, tombstone: 0 });
        await db.update('schedules', { id, tombstone: 0 });
        regenerate = true;
      }
    }
    if (regenerate) {
      const written = await writePaycheckSchedules(
        paycheck.id,
        paycheck.name,
        paycheck.definition,
        paycheck.definition,
      );
      if (JSON.stringify(written) !== JSON.stringify(paycheck.definition)) {
        await db.update('paychecks', {
          id: paycheck.id,
          definition: JSON.stringify(written),
        });
      }
    }
  }
}

async function isLiveSchedule(id: string) {
  return (
    (await db.first('SELECT id FROM schedules WHERE id = ? AND tombstone = 0', [
      id,
    ])) != null
  );
}

async function forgetGenerated(scheduleId: string) {
  const row = await db.first<db.DbPaycheckSchedule>(
    'SELECT * FROM paycheck_schedules WHERE id = ? AND tombstone = 0',
    [scheduleId],
  );
  if (row) {
    await db.delete_('paycheck_schedules', scheduleId);
  }
}

/**
 * Regenerates a paycheck's schedules from its definition and the current
 * account settings, returning the definition with the schedule ids.
 */
async function writePaycheckSchedules(
  paycheckId: PaycheckEntity['id'],
  name: string,
  definition: PaycheckDefinition,
  previous?: PaycheckDefinition,
): Promise<PaycheckDefinition> {
  const { netAmount, depositAmounts } = computePaycheck(definition);
  const clearing = await getAccount(definition.clearingAccount);

  // Split 1 is gross pay; each deduction is a negative split after it
  const deductionActions: RuleActionEntity[] = [];
  for (const [index, deduction] of definition.deductions.entries()) {
    const options = { splitIndex: index + 2 };
    deductionActions.push(
      {
        op: 'set-split-amount',
        value: -deduction.amount,
        options: { ...options, method: 'fixed-amount' },
      },
      { op: 'set', field: 'notes', value: deduction.name, options },
    );
    if (deduction.category) {
      deductionActions.push({
        op: 'set',
        field: 'category',
        value: deduction.category,
        options,
      });
    }
    if (deduction.transferAccount) {
      deductionActions.push({
        op: 'set',
        field: 'payee',
        value: await getTransferPayee(deduction.transferAccount),
        options,
      });
    }
  }

  const paySchedule = await writeSchedule(
    // Schedule ids come only from the stored definition, never the caller
    previous?.paySchedule,
    { name, posts_transaction: true },
    [
      ...(definition.payee
        ? [{ field: 'payee', op: 'is', value: definition.payee } as const]
        : []),
      { field: 'account', op: 'is', value: definition.clearingAccount },
      { field: 'amount', op: 'is', value: netAmount },
      {
        field: 'date',
        op: 'isapprox',
        value: {
          ...definition.date,
          skipWeekend: true,
          weekendSolveMode: definition.weekendSolveMode,
          businessCalendarId: clearing.business_calendar_id ?? undefined,
        },
      },
    ],
    [
      {
        op: 'set-split-amount',
        value: definition.grossAmount,
        options: { splitIndex: 1, method: 'fixed-amount' },
      },
      ...(definition.incomeCategory
        ? [
            {
              op: 'set',
              field: 'category',
              value: definition.incomeCategory,
              options: { splitIndex: 1 },
            } as const,
          ]
        : []),
      ...deductionActions,
    ],
  );

  const clearingPayee = await getTransferPayee(definition.clearingAccount);
  const previousSchedules = new Map(
    (previous?.deposits ?? []).map(d => [d.id, d.schedule]),
  );
  const deposits = [];
  for (const deposit of definition.deposits) {
    const account = await getAccount(deposit.account);
    const schedule = await writeSchedule(
      previousSchedules.get(deposit.id),
      {
        name: depositScheduleName(name, account.name),
        posts_transaction: !!deposit.postAutomatically,
      },
      [
        { field: 'account', op: 'is', value: deposit.account },
        {
          field: 'amount',
          op: 'isapprox',
          value: depositAmounts.get(deposit.id) ?? 0,
        },
        {
          field: 'date',
          op: 'isapprox',
          value: {
            relativeTo: {
              scheduleId: paySchedule,
              offset: account.deposit_days_early ?? 0,
              unit: 'business-days',
              direction: 'before',
            },
            businessCalendarId: account.business_calendar_id ?? undefined,
          },
        },
      ],
      [{ op: 'set', field: 'payee', value: clearingPayee }],
    );
    deposits.push({ ...deposit, schedule });
  }

  // Deposits no longer in the definition lose their schedules
  const kept = new Set(deposits.map(d => d.schedule));
  for (const deposit of previous?.deposits ?? []) {
    if (deposit.schedule && !kept.has(deposit.schedule)) {
      // A schedule that never arrived, or was deleted elsewhere and has just
      // been recreated, has nothing left to delete
      if (await isLiveSchedule(deposit.schedule)) {
        await deleteSchedule({ id: deposit.schedule });
      }
      await forgetGenerated(deposit.schedule);
    }
  }

  await recordGenerated(paycheckId, [paySchedule, ...kept]);
  return { ...definition, paySchedule, deposits };
}

async function createPaycheck({
  name,
  definition,
  newClearingAccountName,
}: {
  name: string;
  definition: PaycheckDefinition;
  // Creates an on-budget clearing account with this name
  newClearingAccountName?: string;
}): Promise<PaycheckEntity['id']> {
  const fields = { ...definition, paySchedule: null };
  await validate(name, fields, undefined, {
    isNewClearingAccount: !!newClearingAccountName,
  });
  if (newClearingAccountName) {
    fields.clearingAccount = await db.insertAccount({
      name: newClearingAccountName,
      offbudget: 0,
      closed: 0,
    });
    await db.insertPayee({ name: '', transfer_acct: fields.clearingAccount });
  }
  // The id comes first, so the schedules can record which paycheck made them
  const id = uuidv4();
  const written = await writePaycheckSchedules(id, name, fields);
  return db.insertWithUUID('paychecks', {
    id,
    name,
    definition: JSON.stringify(written),
  });
}

async function updatePaycheck({
  id,
  name,
  definition,
}: {
  id: PaycheckEntity['id'];
  name: string;
  definition: PaycheckDefinition;
}) {
  const previous = await getPaycheck(id);
  await validate(name, definition, previous.definition);
  const written = await writePaycheckSchedules(
    id,
    name,
    definition,
    previous.definition,
  );
  await db.update('paychecks', {
    id,
    name,
    definition: JSON.stringify(written),
  });
}

// Deletes the paycheck and its schedules; the clearing account and posted
// transactions stay
async function deletePaycheck({ id }: { id: PaycheckEntity['id'] }) {
  const { definition } = await getPaycheck(id);
  // Deposits first: they are relative to the pay schedule
  for (const deposit of definition.deposits) {
    if (deposit.schedule) {
      await deleteSchedule({ id: deposit.schedule });
    }
  }
  if (definition.paySchedule) {
    await deleteSchedule({ id: definition.paySchedule });
  }
  const mapped = await db.all<{ id: string }>(
    'SELECT id FROM paycheck_schedules WHERE paycheck = ? AND tombstone = 0',
    [id],
  );
  for (const row of mapped) {
    await db.delete_('paycheck_schedules', row.id);
  }
  await db.delete_('paychecks', id);
}

async function skipNextPaycheck({ id }: { id: PaycheckEntity['id'] }) {
  const { definition } = await getPaycheck(id);
  const schedules = [
    definition.paySchedule,
    ...definition.deposits.map(d => d.schedule),
  ];
  for (const schedule of schedules) {
    if (schedule) {
      await skipNextDate({ id: schedule });
    }
  }
}

/**
 * Totals the pay schedule's posted transactions, as edited, for the current
 * and previous calendar year (current first).
 */
async function getYearToDate({
  id,
}: {
  id: PaycheckEntity['id'];
}): Promise<PaycheckYearToDate[]> {
  const { definition } = await getPaycheck(id);
  const year = new Date().getFullYear();
  const totals = [year, year - 1].map(y => ({
    year: y,
    gross: 0,
    deductions: new Map<string, number>(),
    net: 0,
  }));
  if (!definition.paySchedule) {
    return totals.map(t => ({ ...t, deductions: [] }));
  }

  const rows = await db.all<
    Pick<
      db.DbViewTransactionInternal,
      'id' | 'date' | 'amount' | 'notes' | 'parent_id' | 'is_child'
    >
  >(
    `SELECT t.id, t.date, t.amount, t.notes, t.parent_id, t.is_child
     FROM v_transactions_internal t
     LEFT JOIN v_transactions_internal p ON p.id = t.parent_id
     WHERE t.tombstone = 0 AND t.date >= ? AND t.date <= ?
       AND ((p.schedule = ? AND p.tombstone = 0)
         OR (t.is_child = 0 AND t.schedule = ?))`,
    [
      (year - 1) * 10000 + 101,
      year * 10000 + 1231,
      definition.paySchedule,
      definition.paySchedule,
    ],
  );
  const parents = new Set(rows.flatMap(r => (r.is_child ? [r.parent_id] : [])));
  for (const row of rows) {
    const total = totals.find(t => t.year === Math.floor(row.date / 10000));
    if (!total) continue;
    if (!row.is_child) {
      total.net += row.amount;
      // An unsplit transaction is all gross pay
      if (!parents.has(row.id)) total.gross += row.amount;
    } else if (row.amount >= 0) {
      // Split 1 is gross pay; positive splits added by edits (bonuses) count too
      total.gross += row.amount;
    } else {
      const name = row.notes ?? '';
      total.deductions.set(
        name,
        (total.deductions.get(name) ?? 0) - row.amount,
      );
    }
  }
  // In the paycheck's order; renamed or removed deductions after them
  const order = definition.deductions.map(d => d.name);
  const rank = (name: string) =>
    order.includes(name) ? order.indexOf(name) : order.length;
  return totals.map(t => ({
    ...t,
    deductions: [...t.deductions]
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => rank(a.name) - rank(b.name)),
  }));
}

// Business days a deposit may arrive after its expected date (imports lag)
const DEPOSIT_GRACE_BUSINESS_DAYS = 2;

/**
 * For each paycheck, its clearing account's balance and the deposits not yet
 * linked for its latest posted pay date. The warning is active once those
 * deposits (or all, if none is missing) are more than the grace period past
 * their expected date on the deposit account's calendar and the balance is
 * not zero.
 */
async function getClearingStatus(): Promise<PaycheckClearingStatus[]> {
  const today = monthUtils.dayFromDate(new Date());
  // Deposit dates read the lookup, which the sync listener refreshes async
  await refreshScheduleDateLookup();
  const statuses: PaycheckClearingStatus[] = [];
  for (const { id, definition } of await getPaychecks()) {
    const row = await db.first<{ balance: number | null }>(
      'SELECT sum(amount) as balance FROM transactions WHERE acct = ? AND isParent = 0 AND tombstone = 0',
      [definition.clearingAccount],
    );
    const balance = row?.balance ?? 0;
    const [payDate, previousPayDate] = definition.paySchedule
      ? (
          await db.all<{ date: number }>(
            `SELECT DISTINCT date FROM v_transactions_internal
             WHERE schedule = ? AND tombstone = 0 AND is_child = 0
             ORDER BY date DESC LIMIT 2`,
            [definition.paySchedule],
          )
        ).map(r => db.fromDateRepr(r.date))
      : [];

    const deposits = [];
    for (const deposit of payDate ? definition.deposits : []) {
      const config = getScheduleDate(deposit.schedule);
      const expectedFor = (day: string) =>
        isRelativeDate(config) ? toRelativeDay(day, config) : day;
      const expectedDate = expectedFor(payDate);
      // Deposits for the previous pay date are on or before its expected date
      const linked =
        deposit.schedule &&
        (await db.first(
          `SELECT id FROM v_transactions_internal
           WHERE schedule = ? AND tombstone = 0 AND is_child = 0 AND date > ?`,
          [
            deposit.schedule,
            previousPayDate ? db.toDateRepr(expectedFor(previousPayDate)) : 0,
          ],
        ));
      const deadline = toRelativeDay(expectedDate, {
        relativeTo: {
          scheduleId: deposit.schedule ?? '',
          offset: DEPOSIT_GRACE_BUSINESS_DAYS,
          unit: 'business-days',
          direction: 'after',
        },
        businessCalendarId: isRelativeDate(config)
          ? config.businessCalendarId
          : undefined,
      });
      deposits.push({
        id: deposit.id,
        account: deposit.account,
        expectedDate,
        isMissing: !linked,
        deadline,
      });
    }
    const missing = deposits.filter(d => d.isMissing);
    statuses.push({
      paycheck: id,
      clearingAccount: definition.clearingAccount,
      balance,
      payDate: payDate ?? null,
      missingDeposits: missing.map(({ id, account, expectedDate }) => ({
        id,
        account,
        expectedDate,
      })),
      isWarning:
        balance !== 0 &&
        deposits.length > 0 &&
        (missing.length > 0 ? missing : deposits).every(
          d => d.deadline < today,
        ),
    });
  }
  return statuses;
}

async function setAccountBusinessDays({
  id,
  businessCalendarId,
  depositDaysEarly,
}: {
  id: AccountEntity['id'];
  businessCalendarId: string | null;
  depositDaysEarly: number;
}) {
  if (
    !Number.isInteger(depositDaysEarly) ||
    depositDaysEarly < 0 ||
    depositDaysEarly > MAX_DEPOSIT_DAYS_EARLY
  ) {
    throw new Error(
      `Days early must be a whole number from 0 to ${MAX_DEPOSIT_DAYS_EARLY}`,
    );
  }
  await db.update('accounts', {
    id,
    business_calendar_id: businessCalendarId,
    deposit_days_early: depositDaysEarly,
  });

  // Paychecks that use the account take their dates from it
  const rows = await db.all<db.DbPaycheck>(
    'SELECT * FROM paychecks WHERE tombstone = 0 AND definition LIKE ?',
    [`%"${id}"%`],
  );
  for (const paycheck of rows.flatMap(row => toPaycheck(row) ?? [])) {
    const written = await writePaycheckSchedules(
      paycheck.id,
      paycheck.name,
      paycheck.definition,
      paycheck.definition,
    );
    // Keeps ids of schedules recreated after being deleted elsewhere
    await db.update('paychecks', {
      id: paycheck.id,
      definition: JSON.stringify(written),
    });
  }
}
