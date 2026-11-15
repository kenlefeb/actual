import { registerAccountWriteTools } from './accounts';
import { registerBudgetWriteTools } from './budget';
import { registerCategoryWriteTools } from './categories';
import { registerPaycheckWriteTools } from './paychecks';
import type { RegisterWriteTool } from './shared';
import { registerTransactionWriteTools } from './transactions';

/**
 * Every write tool, each with the scopes it needs. No tool is left out to
 * limit an agent: the connection's grant decides which calls succeed.
 */
export function registerWriteTools(tool: RegisterWriteTool) {
  registerTransactionWriteTools(tool);
  registerBudgetWriteTools(tool);
  registerPaycheckWriteTools(tool);
  registerAccountWriteTools(tool);
  registerCategoryWriteTools(tool);
}
