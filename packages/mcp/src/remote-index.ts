import { EventEmitter } from 'events';

import { ensurePrivateDir } from './config';
import { closeBudget, openBudget } from './connection';
import { createOAuthServer } from './oauth';
import { assertTokenNotAdmin } from './production-guard';
import { createRecorder, createRemoteHttpServer } from './remote';
import { loadRemoteConfig } from './remote-config';
import { registerShutdown } from './shutdown';
import { redirectConsoleToStderr } from './stdio';
import { recordSync, startSyncSchedule } from './sync';

async function main() {
  redirectConsoleToStderr();

  const config = loadRemoteConfig(process.env, process.argv.slice(2));
  if (config.production) {
    // Before the data directory, sign-in or the listener.
    await assertTokenNotAdmin(config);
    process.stderr.write('actual-mcp-http: production mode is on.\n');
  }
  ensurePrivateDir(config.dataDir);
  // The authorization server is always on: there is no way to serve without it.
  // Throws before anything is opened if the address is public with loose host names.
  const record = createRecorder(config);
  const oauth = createOAuthServer(config.oauth, {
    record,
    allowedHosts: config.allowedHosts,
  });
  const server = createRemoteHttpServer(config, { oauth });
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
