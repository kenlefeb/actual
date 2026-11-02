import { createServer } from 'http';
import type { Server, ServerResponse } from 'http';
import type { AddressInfo } from 'net';

import { assertTokenNotAdmin } from './production-guard';

const TOKEN = 'minted-token-0123456789';
let server: Server;
let seenToken: string | undefined;
let reply: (res: ServerResponse) => void;

async function start() {
  server = createServer((req, res) => {
    seenToken = req.headers['x-actual-token'] as string;
    expect(req.url).toBe('/account/validate');
    reply(res);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(() => new Promise(r => server?.close(r)));

const json = (status: number, body: unknown) => (res: ServerResponse) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};

async function message(serverUrl: string) {
  try {
    await assertTokenNotAdmin({ serverUrl, sessionToken: TOKEN });
  } catch (error) {
    return (error as Error).message;
  }
  return '';
}

describe("A production token is never an administrator's", () => {
  it("An administrator's token", async () => {
    reply = json(200, {
      status: 'ok',
      data: { validated: true, permission: 'ADMIN' },
    });
    const url = await start();
    const m = await message(url);
    expect(m).toMatch(/administrator/);
    expect(m).not.toContain(TOKEN);
    expect(seenToken).toBe(TOKEN);
  });

  it('A token that cannot be validated', async () => {
    for (const r of [
      json(401, { status: 'error', reason: 'unauthorized' }),
      json(200, { status: 'ok', data: { validated: true } }), // no permission
      json(200, 'not an object'),
      (res: ServerResponse) => res.destroy(),
    ]) {
      reply = r;
      const url = await start();
      const m = await message(url);
      expect(m).toMatch(/could not be validated/);
      expect(m).not.toContain(TOKEN);
      await new Promise(r2 => server.close(r2));
    }
    // Nothing answering at all.
    expect(await message('http://127.0.0.1:1')).toMatch(
      /could not be validated/,
    );
  });

  it('A non-administrator token passes', async () => {
    reply = json(200, {
      status: 'ok',
      data: { validated: true, permission: 'BASIC' },
    });
    expect(await message(await start())).toBe('');
  });
});
