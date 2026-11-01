import { EventEmitter } from 'events';

import { ensurePrivateDir } from './config';
import { closeBudget, openBudget } from './connection';
import { createRemoteHttpServer } from './remote';
import { loadRemoteConfig } from './remote-config';
import { registerShutdown } from './shutdown';
import { redirectConsoleToStderr } from './stdio';
import { recordSync, startSyncSchedule } from './sync';

async function main() {
  redirectConsoleToStderr();

  const config = loadRemoteConfig(process.env, process.argv.slice(2));
  ensurePrivateDir(config.dataDir);
  // Throws before anything is opened if the address is public without authentication.
  const server = createRemoteHttpServer(config);
  await openBudget(config);
  recordSync(true); // the download is the sync at start
  const stopSync = startSyncSchedule(config.syncIntervalMs);

  // A daemon's stdin may be closed or absent: only signals stop it.
  registerShutdown(
    async () => {
      stopSync();
      server.close();
      await closeBudget();
    },
    undefined,
    new EventEmitter(),
  );
  server.listen(config.listen.port, config.listen.host);
}

main().catch(error => {
  // Every error thrown above has fixed text; none echoes a credential or URL.
  const detail = error instanceof Error ? error.message : 'Unexpected error';
  process.stderr.write(`actual-mcp-http: ${detail}\n`);
  process.exit(1);
});
