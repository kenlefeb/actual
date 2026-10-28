import { createApp } from '#server/app';
import * as db from '#server/db';
import { mutator } from '#server/mutators';
import {
  createSchedule,
  deleteSchedule,
  getRuleForSchedule,
  skipNextDate,
  updateSchedule,
} from '#server/schedules/app';
import { updateRule } from '#server/transactions/transaction-rules';
import { undoable } from '#server/undo';
import { computePaycheck, MAX_DEPOSIT_DAYS_EARLY } from '#shared/paychecks';
import type {
  AccountEntity,
  PaycheckDefinition,
  PaycheckEntity,
  RuleActionEntity,
  RuleConditionEntity,
} from '#types/models';

export type PaychecksHandlers = {
  'paychecks-get': typeof getPaychecks;
  'paycheck-create': typeof createPaycheck;
  'paycheck-update': typeof updatePaycheck;
  'paycheck-delete': typeof deletePaycheck;
  'paycheck-skip-next': typeof skipNextPaycheck;
  'account-set-business-days': typeof setAccountBusinessDays;
};

export const app = createApp<PaychecksHandlers>();
app.method('paychecks-get', getPaychecks);
app.method('paycheck-create', mutator(undoable(createPaycheck)));
app.method('paycheck-update', mutator(undoable(updatePaycheck)));
app.method('paycheck-delete', mutator(undoable(deletePaycheck)));
app.method('paycheck-skip-next', mutator(undoable(skipNextPaycheck)));
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

/**
 * Regenerates a paycheck's schedules from its definition and the current
 * account settings, returning the definition with the schedule ids.
 */
async function writePaycheckSchedules(
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
      await deleteSchedule({ id: deposit.schedule });
    }
  }

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
  const written = await writePaycheckSchedules(name, fields);
  return db.insertWithUUID('paychecks', {
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
