import type { RegisterTool } from '#tools/read/shared';

import { registerAccountWriteTools } from './accounts';
import { registerBudgetWriteTools } from './budget';
import { registerPaycheckWriteTools } from './paychecks';
import { registerTransactionWriteTools } from './transactions';

/**
 * The v1 write set and nothing else: no delete, bulk edit, import, rule,
 * account close or budget reset tools (those are a later story). Each tool
 * appends its audit line to `auditLog` before it writes.
 */
export function registerWriteTools(tool: RegisterTool, auditLog: string) {
  registerTransactionWriteTools(tool, auditLog);
  registerBudgetWriteTools(tool, auditLog);
  registerPaycheckWriteTools(tool, auditLog);
  registerAccountWriteTools(tool, auditLog);
}
