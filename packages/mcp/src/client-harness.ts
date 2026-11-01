import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { buildFixtureBudget } from './fixture';
import { createServer } from './tools';

/** A fixture budget plus an in-memory MCP client on a server over it. */
export async function startHarness(
  options?: Parameters<typeof buildFixtureBudget>[0],
) {
  const fixture = await buildFixtureBudget(options);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverT);
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
    close: async () => {
      await client.close();
      await fixture.cleanup();
    },
  };
}
