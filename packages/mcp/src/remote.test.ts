import { readFileSync } from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import { join } from 'path';

import * as api from '@actual-app/api';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { buildFixtureBudget } from './fixture';
import { createLimiter, createRemoteHttpServer, sourceOf } from './remote';
import type { RemoteOptions } from './remote';
import type { RemoteConfig } from './remote-config';
import { createServer } from './server';

const SECRET = 'hunter2-secret';

function config(over: Partial<RemoteConfig> = {}): RemoteConfig {
  return {
    serverUrl: 'http://127.0.0.1:1',
    password: SECRET,
    syncId: 'sync',
    encryptionPassword: undefined,
    dataDir: '/tmp/actual-mcp-remote-test',
    env: 'staging',
    writes: false,
    auditLog: '',
    secrets: [SECRET],
    listen: { host: '127.0.0.1', port: 0 },
    allowedHosts: ['localhost', '127.0.0.1', 'hosted.example.test'],
    allowedOrigins: [],
    syncIntervalMs: 300_000,
    rate: { perEndpoint: 1000, perClient: 1000, windowMs: 60_000 },
    oauth: {
      publicUrl: 'https://hosted.example.test',
      signingKey: 'unused-in-these-tests-0123456789abcdef',
      clientId: 'c',
      clientSecret: 'unused-client-secret',
      redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
      allowDynamicRegistration: false,
      stateFile: '/tmp/actual-mcp-remote-test/oauth-state.json',
      idp: {
        issuer: 'https://idp.example.test',
        authorizationUrl: 'https://idp.example.test/auth',
        tokenUrl: 'https://idp.example.test/token',
        clientId: 'i',
        clientSecret: 'unused-idp-secret',
        account: 'a@example.test',
      },
    },
    ...over,
  };
}

let fixture: Awaited<ReturnType<typeof buildFixtureBudget>>;
let server: http.Server;
let port: number;
let client: Client | undefined;
let records: Array<Record<string, unknown>>;

async function start(
  over: Partial<RemoteConfig> = {},
  options: RemoteOptions = {},
  budget: Parameters<typeof buildFixtureBudget>[0] = { count: 2 },
) {
  fixture = await buildFixtureBudget(budget);
  records = [];
  server = createRemoteHttpServer(config(over), {
    log: record => records.push(record),
    ...options,
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
}

async function connect(headers: Record<string, string> = {}) {
  client = new Client({ name: 'test', version: '0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers },
    }),
  );
  return client;
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const res = await client!.callTool({ name, arguments: args });
  const text = (res.content as Array<{ text: string }>)[0].text;
  return {
    isError: Boolean(res.isError),
    text,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    json: res.isError ? null : (JSON.parse(text) as any),
  };
}

/** A raw request, so a test can set Host and Origin freely. */
function raw({
  method = 'POST',
  path = '/mcp',
  headers = {},
  body = '{}',
}: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
} = {}) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers },
      res => {
        let text = '';
        res.on('data', chunk => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on('error', reject);
    req.end(method === 'GET' ? undefined : body);
  });
}

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

afterEach(async () => {
  vi.restoreAllMocks();
  await client?.close().catch(() => undefined);
  client = undefined;
  await new Promise<void>(resolve => server.close(() => resolve()));
  await fixture.cleanup();
});

describe('a separate hosted entry', () => {
  it('The stdio entry still opens no listener', async () => {
    await start();
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf8');
    expect(source).not.toMatch(/from 'https?'|from 'net'|\.listen\(/);
    expect(source).not.toMatch(/remote/);
  });

  it('The hosted entry serves the same read tools', async () => {
    await start();
    await connect();
    const hosted = (await client!.listTools()).tools.map(t => t.name).sort();

    // The stdio entry's server: the same registration, no extras.
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await createServer([SECRET]).connect(serverT);
    const stdio = new Client({ name: 'test', version: '0' });
    await stdio.connect(clientT);
    const local = (await stdio.listTools()).tools.map(t => t.name);
    await stdio.close();

    expect(hosted).toEqual([...local, 'get_sync_status'].sort());
    expect(hosted.some(n => n.startsWith('write_'))).toBe(false);
  });

  it('No authentication, no public listener', async () => {
    fixture = await buildFixtureBudget({ count: 1 });
    server = http.createServer();
    const open = { listen: { host: '0.0.0.0', port: 0 } };
    expect(() => createRemoteHttpServer(config(open))).toThrow(/loopback/);
    // With an authentication hook the address is the operator's choice, but
    // only the public hostname may be allowed: no loopback or wildcard names.
    const authenticate = () => ({ clientId: 'c' });
    expect(() =>
      createRemoteHttpServer(config(open), { authenticate }),
    ).toThrow(/public hostname/);
    expect(() =>
      createRemoteHttpServer(
        config({ ...open, allowedHosts: ['hosted.example.test', '*'] }),
        { authenticate },
      ),
    ).toThrow(/public hostname/);
    expect(() =>
      createRemoteHttpServer(
        config({ ...open, allowedHosts: ['hosted.example.test'] }),
        { authenticate },
      ),
    ).not.toThrow();
  });

  it('Only POST to the MCP endpoint is served', async () => {
    await start();
    expect((await raw({ method: 'GET', headers: MCP_HEADERS })).status).toBe(
      405,
    );
    expect(
      (await raw({ path: '/elsewhere', headers: MCP_HEADERS })).status,
    ).toBe(404);
  });
});

describe('host, origin and rate checks', () => {
  it('A rebinding host', async () => {
    await start();
    const res = await raw({
      headers: { ...MCP_HEADERS, host: 'evil.example.test' },
    });
    expect(res.status).toBe(403);
    const ok = await raw({
      headers: { ...MCP_HEADERS, host: 'hosted.example.test:8787' },
    });
    expect(ok.status).not.toBe(403);
  });

  it('A browser origin', async () => {
    await start({ allowedOrigins: ['https://claude.ai'] });
    const refused = await raw({
      headers: { ...MCP_HEADERS, origin: 'https://evil.example.test' },
    });
    expect(refused.status).toBe(403);
    const allowed = await raw({
      headers: { ...MCP_HEADERS, origin: 'https://claude.ai' },
    });
    expect(allowed.status).not.toBe(403);
    // Server-to-server traffic carries no Origin at all.
    expect((await raw({ headers: MCP_HEADERS })).status).not.toBe(403);
  });

  it('One client over its limit', async () => {
    await start(
      { rate: { perEndpoint: 1000, perClient: 2, windowMs: 60_000 } },
      {
        authenticate: req => ({
          clientId: String(req.headers['x-client'] ?? 'anonymous'),
        }),
      },
    );
    const call = (id: string) =>
      raw({ headers: { ...MCP_HEADERS, 'x-client': id } }).then(r => r.status);
    expect(await call('a')).not.toBe(429);
    expect(await call('a')).not.toBe(429);
    expect(await call('a')).toBe(429);
    expect(await call('b')).not.toBe(429);
  });

  it('A flood', async () => {
    await start({
      rate: { perEndpoint: 3, perClient: 1000, windowMs: 60_000 },
    });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await raw({ headers: MCP_HEADERS })).status);
    }
    expect(statuses.slice(0, 3).every(s => s !== 429)).toBe(true);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  it('A flood from one source spares another', async () => {
    await start({
      rate: { perEndpoint: 3, perClient: 1000, windowMs: 60_000 },
    });
    const from = (ip: string, path: string) =>
      raw({
        path,
        headers: { ...MCP_HEADERS, 'x-forwarded-for': ip },
      }).then(r => r.status);
    for (const path of ['/authorize', '/token', '/revoke']) {
      const flood: number[] = [];
      for (let i = 0; i < 5; i++) flood.push(await from('198.51.100.7', path));
      expect(flood.slice(3)).toEqual([429, 429]);
      expect(await from('203.0.113.9', path)).not.toBe(429);
    }
  });

  it('A forged forwarded address cannot dodge the limit', async () => {
    await start({
      rate: { perEndpoint: 3, perClient: 1000, windowMs: 60_000 },
    });
    // The proxy sets the real address (and a different one would append it last);
    // earlier entries are the caller's own.
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push(
        (
          await raw({
            path: '/token',
            headers: {
              ...MCP_HEADERS,
              'x-forwarded-for': `10.0.0.${i}, 198.51.100.7`,
            },
          })
        ).status,
      );
    }
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  it('An unresolved source is logged once, without the header', async () => {
    await start();
    const unresolved = () =>
      records.filter(r => r.reason === 'source-unresolved');
    await raw({ path: '/token', headers: MCP_HEADERS });
    await raw({
      path: '/token',
      headers: { ...MCP_HEADERS, 'x-forwarded-for': 'secret-garbage' },
    });
    await raw({ path: '/token', headers: MCP_HEADERS });
    expect(unresolved()).toHaveLength(1);
    expect(unresolved()[0]).toMatchObject({
      event: 'warning',
      endpoint: '/token',
    });
    expect(JSON.stringify(records)).not.toContain('secret-garbage');
    // A resolved source never logs it.
    await raw({
      path: '/token',
      headers: { ...MCP_HEADERS, 'x-forwarded-for': '198.51.100.7' },
    });
    expect(unresolved()).toHaveLength(1);
  });

  it('Distinct paths share one limit', async () => {
    await start({
      rate: { perEndpoint: 3, perClient: 1000, windowMs: 60_000 },
    });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await raw({ path: `/probe-${i}`, headers: MCP_HEADERS })).status,
      );
    }
    expect(statuses.filter(s => s === 429)).toHaveLength(3);
    expect(statuses.slice(3).every(s => s === 429)).toBe(true);
  });

  it('A refusal is recorded', async () => {
    await start();
    await raw({ headers: { ...MCP_HEADERS, host: 'evil.example.test' } });
    expect(records).toContainEqual(
      expect.objectContaining({ event: 'refused', reason: 'host' }),
    );
  });
});

describe('access is recorded without data', () => {
  it('A tool call is recorded', async () => {
    await start();
    await connect();
    const res = await callTool('list_payees', { search: 'zebra-term' });
    expect(res.isError).toBe(false);
    const call = records.find(r => r.event === 'tool_call');
    expect(call).toMatchObject({
      event: 'tool_call',
      tool: 'list_payees',
      status: 'ok',
      client: 'anonymous',
    });
    expect(typeof call?.time).toBe('string');
    const logged = JSON.stringify(records);
    expect(logged).not.toContain('zebra-term');
    expect(logged).not.toContain('Landlord');
  });

  it('An audit line names its identity', async () => {
    await start(
      {},
      { authenticate: () => ({ clientId: 'c1', subject: 'oauth-sub-1' }) },
    );
    await connect();
    await callTool('list_payees');
    expect(records.find(r => r.event === 'tool_call')).toMatchObject({
      client: 'c1',
      subject: 'oauth-sub-1',
      user_id: 'unknown',
    });
  });

  it('Errors carry no secrets', async () => {
    await start();
    await connect();
    vi.spyOn(api, 'getPayees').mockRejectedValue(new Error(`boom ${SECRET}`));
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const res = await callTool('list_payees');
    expect(res.isError).toBe(true);
    expect(res.text).not.toContain(SECRET);
    const logged =
      stderr.mock.calls.map(c => String(c[0])).join('') +
      JSON.stringify(records);
    expect(logged).not.toContain(SECRET);
    expect(records).toContainEqual(
      expect.objectContaining({ event: 'tool_call', status: 'error' }),
    );
  });
});

describe('the source of a request', () => {
  it('trusts the forwarded address only from a loopback peer', () => {
    expect(sourceOf('127.0.0.1', '1.2.3.4, 198.51.100.7')).toBe('198.51.100.7');
    expect(sourceOf('::ffff:127.0.0.1', '198.51.100.7')).toBe('198.51.100.7');
    expect(sourceOf('::1', undefined)).toBe('loopback');
    expect(sourceOf('192.0.2.5', '198.51.100.7')).toBe('192.0.2.5');
  });

  it('keys an IPv6 source by its /64', () => {
    const a = sourceOf('127.0.0.1', '2001:db8:1:2:aaaa::1');
    const b = sourceOf('127.0.0.1', '2001:db8:1:2:bbbb::9');
    expect(a).toBe(b);
    expect(sourceOf('127.0.0.1', '2001:db8:1:3::1')).not.toBe(a);
  });

  it('reads an address with a port, a trailing comma or spaces', () => {
    expect(sourceOf('127.0.0.1', '198.51.100.7:4433')).toBe('198.51.100.7');
    expect(sourceOf('127.0.0.1', '[2001:db8:1:2::1]:443')).toBe(
      sourceOf('127.0.0.1', '2001:db8:1:2::9'),
    );
    expect(sourceOf('127.0.0.1', '198.51.100.7,')).toBe('198.51.100.7');
    expect(sourceOf('127.0.0.1', ' 198.51.100.7 , ')).toBe('198.51.100.7');
  });

  it('keys an empty header as loopback', () => {
    expect(sourceOf('127.0.0.1', '')).toBe('loopback');
    expect(sourceOf('127.0.0.1', ' , ')).toBe('loopback');
  });

  it('falls back to the peer when the header is not an address', () => {
    expect(sourceOf('192.0.2.5', 'garbage')).toBe('192.0.2.5');
    expect(sourceOf('127.0.0.1', 'garbage')).toBe('loopback');
  });
});

describe('the limiter key table', () => {
  it('stays bounded by dropping the oldest source', () => {
    const limit = createLimiter(1, 60_000, 2);
    expect(limit('a')).toBe(true);
    expect(limit('a')).toBe(false);
    expect(limit('b')).toBe(true);
    expect(limit('c')).toBe(true); // table is full: "a" is dropped
    expect(limit('a')).toBe(true); // so it starts afresh
  });
});

describe('only configured upstreams', () => {
  it('A URL in a note', async () => {
    await start(
      {},
      {},
      { count: 1, overrides: { notes: 'see https://example.invalid/steal' } },
    );
    await connect();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const [row] = (await callTool('list_transactions')).json.items;
    expect(row.text.notes).toBe('see https://example.invalid/steal');
    expect(
      fetchSpy.mock.calls.some(c => String(c[0]).includes('example.invalid')),
    ).toBe(false);
  });
});
