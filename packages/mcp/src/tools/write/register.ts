import type { Identity } from '#audit';
import type { RegisterTool } from '#tools/read/shared';

import { registerAccountWriteTools } from './accounts';
import { registerBudgetWriteTools } from './budget';
import { registerCategoryWriteTools } from './categories';
import { registerPaycheckWriteTools } from './paychecks';
import { registerTransactionWriteTools } from './transactions';

/**
 * The write set and nothing else: no delete (except category and group), bulk
 * edit, import, rule, account close or budget reset tools (those are a later
 * story, sc-1556). Each tool
 * appends its audit line to `auditLog` before it writes.
 */
export function registerWriteTools(
  tool: RegisterTool,
  auditLog: string,
  scrub: (message: string) => string,
  identity: Identity,
) {
  const log = { path: auditLog, scrub, identity };
  registerTransactionWriteTools(tool, log);
  registerBudgetWriteTools(tool, log);
  registerPaycheckWriteTools(tool, log);
  registerAccountWriteTools(tool, log);
  registerCategoryWriteTools(tool, log);
}
