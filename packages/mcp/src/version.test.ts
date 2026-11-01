import { readFileSync } from 'node:fs';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from './tools';

describe('server version', () => {
  it('The server reports its version', async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverT);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientT);

    const { version } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(client.getServerVersion()?.version).toBe(version);
    await client.close();
  });
});
