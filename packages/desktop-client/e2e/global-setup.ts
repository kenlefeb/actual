import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Build the sync server once for the whole run. Each startSyncServer() used to
// run `vite build` itself, and parallel workers emptied each other's build/
// folder mid-start (sc-2948).
// oxlint-disable-next-line import/no-default-export -- Playwright needs a default export
export default function globalSetup() {
  execFileSync('yarn', ['workspace', '@actual-app/sync-server', 'build'], {
    cwd: path.join(__dirname, '..', '..', '..'),
    stdio: 'inherit',
  });
}
