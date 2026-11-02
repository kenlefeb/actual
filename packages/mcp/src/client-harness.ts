import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { Identity } from './audit';
import { buildFixtureBudget } from './fixture';
import { createServer } from './server';

const SECRET = 'harness-secret-password';

/**
 * A fixture budget plus an in-memory MCP client on a server over it. With
 * `writes`, the server gets the write tools and an audit log in its own temp
 * directory.
 */
export async function startHarness(
  options?: Parameters<typeof buildFixtureBudget>[0],
  { writes = false, identity }: { writes?: boolean; identity?: Identity } = {},
) {
  const fixture = await buildFixtureBudget(options);
  const auditDir = await mkdtemp(join(tmpdir(), 'actual-mcp-audit-'));
  const auditLog = join(auditDir, 'test.audit.jsonl');
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await createServer([SECRET], writes ? { auditLog, identity } : {}).connect(
    serverT,
  );
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientT);

  async function call(name: string, args: Record<string, unknown> = {}) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ text: string }>)[0].text;
    return {
      isError: Boolean(res.isError),
      text,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      json: res.isError ? null : (JSON.parse(text) as any),
    };
  }

  return {
    fixture,
    client,
    call,
    auditDir,
    auditLog,
    secret: SECRET,
    close: async () => {
      await client.close();
      await fixture.cleanup();
      await rm(auditDir, { recursive: true, force: true });
    },
  };
}
