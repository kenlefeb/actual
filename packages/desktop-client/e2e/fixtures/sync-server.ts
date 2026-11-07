import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type SyncServer = { url: string; stop: () => void };

const repoRoot = path.join(__dirname, '..', '..', '..', '..');

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('No free port')),
      );
    });
  });
}

function kill(child: ChildProcess) {
  if (child.pid && child.exitCode === null) {
    try {
      // The whole group: yarn, the build and node
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Already gone
    }
  }
}

// A sync server of its own for one test file, with a throwaway data directory.
// `extraEnv` gets the server's URL, for settings that name it.
export async function startSyncServer(
  extraEnv: (url: string) => NodeJS.ProcessEnv = () => ({}),
): Promise<SyncServer> {
  const port = await freePort();
  const url = `http://localhost:${port}`;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'actual-e2e-sync-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extraEnv(url),
    ACTUAL_PORT: String(port),
    ACTUAL_DATA_DIR: dataDir,
    ACTUAL_SERVER_FILES: path.join(dataDir, 'server-files'),
    ACTUAL_USER_FILES: path.join(dataDir, 'user-files'),
  };
  // Development mode would proxy page requests to the web dev server
  delete env.NODE_ENV;
  const child = spawn(
    'yarn',
    ['workspace', '@actual-app/sync-server', 'start'],
    {
      cwd: repoRoot,
      env,
      detached: true,
      stdio: 'ignore',
    },
  );

  let isStopped = false;
  const stop = () => {
    if (isStopped) {
      return;
    }
    isStopped = true;
    kill(child);
    rmSync(dataDir, { recursive: true, force: true });
    process.off('exit', stop);
  };
  process.on('exit', stop);

  // `start` runs a vite build first, which is slow in CI's Docker job
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      stop();
      throw new Error(`Sync server exited with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${url}/info`);
      if (response.ok) {
        return { url, stop };
      }
    } catch {
      // Not listening yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  stop();
  throw new Error('Sync server did not start within 240 seconds');
}
