import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { ensurePrivateDir, loadConfig } from './config';
import { closeBudget, openBudget } from './connection';
import { createServer } from './tools';

async function main() {
  // stdout carries the MCP protocol; anything else writing to it would corrupt it.
  console.log = console.error;

  const config = loadConfig(process.env, process.argv.slice(2));
  ensurePrivateDir(config.dataDir);
  await openBudget(config);

  const server = createServer(config.secrets);
  await server.connect(new StdioServerTransport());

  const stop = () => void closeBudget().finally(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch(error => {
  // Every error thrown above has fixed text; none echoes a credential or URL.
  const detail = error instanceof Error ? error.message : 'Unexpected error';
  process.stderr.write(`actual-mcp: ${detail}\n`);
  process.exit(1);
});
