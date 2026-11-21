import type { Scope } from '#grants';

/**
 * Every write tool is in exactly one of these tables (design D4); a test fails
 * when one is not, and the server refuses to register an undeclared write tool.
 */

/** The scopes each undoable tool's reversal needs, by tool name; never read from a log line. */
export const UNDOABLE: Record<string, Scope[]> = {
  write_update_transactions: ['transactions:write'],
  write_create_transactions: ['transactions:write'],
  write_set_budget_amount: ['budget:write'],
  write_set_budget_amounts: ['budget:write'],
  write_copy_budget_month: ['budget:write'],
  write_set_budget_to_average: ['budget:write'],
  write_update_category: ['structure:write'],
  write_update_category_group: ['structure:write'],
  write_create_category: ['structure:write'],
  write_create_payee: ['structure:write'],
  write_create_category_group: ['structure:write'],
  write_delete_transactions: ['transactions:write', 'delete'],
  write_delete_category: ['structure:write', 'delete'],
  write_delete_category_group: ['structure:write', 'delete'],
  write_move_category: ['structure:write'],
  write_move_category_group: ['structure:write'],
  write_create_schedule: ['schedules:write'],
  write_update_schedule: ['schedules:write'],
};

const PLANNED = 'not undoable yet; undo is planned in sc-5097';

/** Why each other write tool is not undoable: fixed text, shown only for the caller's own write. */
export const NOT_UNDOABLE: Record<string, string> = {
  write_apply_budget_templates:
    'it also stores goals and template automations, which undo cannot restore',
  write_set_budget_carryover:
    'it changes every later month and only the first is logged; undo is planned in sc-5097',
  write_hold_budget_for_next_month: 'clear it with write_reset_budget_hold',
  write_reset_budget_hold: 'hold again with write_hold_budget_for_next_month',
  write_skip_paycheck: 'the engine cannot yet put back a skipped date',
  write_skip_schedule_date: 'the engine cannot put back a skipped date',
  write_post_schedule_transaction:
    'delete the transaction it added with write_delete_transactions',
  write_create_account: 'delete the account with write_delete_account',
  write_update_account: PLANNED,
  write_reopen_account: PLANNED,
  write_create_account_group: PLANNED,
  write_update_account_group: PLANNED,
  write_delete_account_group:
    'its accounts became ungrouped; recreate the group and regroup them',
  write_close_account: 'the bank-sync unlink cannot be undone',
  write_delete_account:
    'it deletes the account and every row in it with no snapshot, and the bank-sync unlink cannot be undone',
  write_move_on_budget: 'the app has no move-off-budget action',
  write_set_account_business_days:
    'regenerating paychecks can clear skips and recreate schedules',
  write_reconcile_account: 'MCP cannot unlock reconciled rows',
  write_undo: 'an undo cannot be undone',
};

/** The sentence a write tool's description carries: whether write_undo reverses it, or why not. */
export function declaration(tool: string) {
  if (tool in UNDOABLE) return 'write_undo reverses it.';
  if (tool in NOT_UNDOABLE) return `Not undoable: ${NOT_UNDOABLE[tool]}.`;
  return undefined;
}
