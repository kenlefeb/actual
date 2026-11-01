import * as api from '@actual-app/api';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { ensurePrivateDir, loadConfig } from './config';
import { scrubSecrets } from './sanitize';
import { createServer } from './tools';

async function main() {
  // stdout carries the MCP protocol; anything else writing to it would corrupt it.
  console.log = console.error;

  const config = loadConfig(process.env);
  ensurePrivateDir(config.dataDir);

  await api.init({
    serverURL: config.serverUrl,
    dataDir: config.dataDir,
    password: config.password,
  });
  await api.downloadBudget(config.syncId, {
    password: config.encryptionPassword,
  });

  const server = createServer(config.secrets);
  await server.connect(new StdioServerTransport());

  const stop = () => void api.shutdown().finally(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch(error => {
  const detail = error instanceof Error ? error.message : String(error);
  // The password may be in an upstream error message; scrub before logging.
  const secrets = [
    process.env.ACTUAL_MCP_PASSWORD,
    process.env.ACTUAL_MCP_ENCRYPTION_PASSWORD,
  ].filter((s): s is string => Boolean(s));
  process.stderr.write(`actual-mcp: ${scrubSecrets(detail, secrets)}\n`);
  process.exit(1);
});
