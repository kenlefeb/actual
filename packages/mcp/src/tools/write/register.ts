import type { Limits } from '#limits';

import { registerAccountBusinessDaysTool } from './account-business-days';
import { registerAccountCloseTools } from './account-close';
import { registerAccountWriteTools } from './accounts';
import { registerBudgetWriteTools } from './budget';
import { registerCategoryWriteTools } from './categories';
import { registerPaycheckWriteTools } from './paychecks';
import { registerPayeeWriteTools } from './payees';
import { registerReconcileTool } from './reconcile';
import { registerScheduleWriteTools } from './schedules';
import type { RegisterWriteTool } from './shared';
import { registerTransactionWriteTools } from './transactions';

/**
 * Every write tool, each with the scopes it needs. No tool is left out to
 * limit an agent: the connection's grant decides which calls succeed.
 */
export function registerWriteTools(tool: RegisterWriteTool, limits: Limits) {
  registerTransactionWriteTools(tool, limits);
  registerBudgetWriteTools(tool, limits);
  registerPaycheckWriteTools(tool, limits);
  registerScheduleWriteTools(tool);
  registerAccountWriteTools(tool);
  registerAccountCloseTools(tool);
  registerAccountBusinessDaysTool(tool);
  registerCategoryWriteTools(tool, limits);
  registerPayeeWriteTools(tool);
  registerReconcileTool(tool);
}
