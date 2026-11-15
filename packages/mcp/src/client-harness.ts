import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { Identity } from './audit';
import { buildFixtureBudget } from './fixture';
import { SCOPES } from './grants';
import type { Grant } from './grants';
import { createServer } from './server';

const SECRET = 'harness-secret-password';

/**
 * A fixture budget plus an in-memory MCP client on a server over it, with an
 * audit log in its own temp directory. The grant is `grant`, else the stdio
 * `--writes` default (every scope, no confirm) with `writes`, else `budget:read`.
 */
export async function startHarness(
  options?: Parameters<typeof buildFixtureBudget>[0],
  {
    writes = false,
    identity,
    grant,
    client: clientId,
  }: {
    writes?: boolean;
    identity?: Identity;
    grant?: Grant;
    client?: string;
  } = {},
) {
  const fixture = await buildFixtureBudget(options);
  const auditDir = await mkdtemp(join(tmpdir(), 'actual-mcp-audit-'));
  const auditLog = join(auditDir, 'test.audit.jsonl');
  const effective: Grant = grant ?? {
    scopes: writes ? [...SCOPES] : ['budget:read'],
    confirm_destructive: false,
  };
  const clients: Client[] = [];

  /** Another client on the same budget, as OAuth client `as`. */
  async function connectAs(as: string | undefined) {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await createServer([SECRET], {
      auditLog,
      identity,
      grant: () => effective,
      client: as,
    }).connect(serverT);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientT);
    clients.push(client);

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
    return { client, call };
  }

  const { client, call } = await connectAs(clientId);

  return {
    fixture,
    client,
    call,
    connectAs,
    auditDir,
    auditLog,
    secret: SECRET,
    close: async () => {
      for (const c of clients) await c.close();
      await fixture.cleanup();
      await rm(auditDir, { recursive: true, force: true });
    },
  };
}
