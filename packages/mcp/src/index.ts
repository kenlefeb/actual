import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { ensurePrivateDir, loadConfig } from './config';
import { closeBudget, openBudget } from './connection';
import { createServer } from './server';
import { registerShutdown } from './shutdown';
import { redirectConsoleToStderr } from './stdio';

async function main() {
  redirectConsoleToStderr();

  const config = loadConfig(process.env, process.argv.slice(2));
  ensurePrivateDir(config.dataDir);
  await openBudget(config);

  const server = createServer(
    config.secrets,
    config.writes ? { auditLog: config.auditLog } : {},
  );
  server.server.onclose = registerShutdown(closeBudget);
  await server.connect(new StdioServerTransport());
}

main().catch(error => {
  // Every error thrown above has fixed text; none echoes a credential or URL.
  const detail = error instanceof Error ? error.message : 'Unexpected error';
  process.stderr.write(`actual-mcp: ${detail}\n`);
  process.exit(1);
});
