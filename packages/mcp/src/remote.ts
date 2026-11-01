import http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import type { RemoteConfig } from './remote-config';
import { scrubSecrets } from './sanitize';
import { createServer } from './server';
import { registerSyncStatusTool } from './sync';

/** Who is calling. Group 2 has no authentication; the OAuth slice supplies this hook. */
export type Authenticate = (
  req: IncomingMessage,
) => { clientId: string } | null | Promise<{ clientId: string } | null>;

export type RemoteOptions = {
  authenticate?: Authenticate;
  /** Receives each access record; the default writes scrubbed JSON lines to stderr. */
  log?: (record: Record<string, unknown>) => void;
};

const MAX_BODY_BYTES = 1_000_000;
const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];

/** A fixed-window counter per key; expired keys are dropped as new ones arrive. */
function createLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string) => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    const hit = hits.get(key) ?? { count: 0, resetAt: now + windowMs };
    hit.count++;
    hits.set(key, hit);
    return hit.count <= limit;
  };
}

function hostName(header: string | undefined) {
  if (!header) return '';
  // "[::1]:8787" keeps its brackets; "host:8787" loses the port.
  const host = header.startsWith('[')
    ? header.slice(0, header.indexOf(']') + 1)
    : header.split(':')[0];
  return host.toLowerCase();
}

function readBody(req: IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

function send(
  res: ServerResponse,
  status: number,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify({ error: http.STATUS_CODES[status] ?? 'Error' }));
}

/**
 * The hosted entry's HTTP listener: stateless streamable HTTP on `/mcp`, with
 * Host, Origin and rate checks ahead of everything else. Read-only by
 * construction: it only ever builds the stdio entry's read tools plus
 * `get_sync_status`. Without an `authenticate` hook it refuses a non-loopback
 * address. Returns the unstarted server; the caller listens.
 */
export function createRemoteHttpServer(
  config: RemoteConfig,
  { authenticate, log }: RemoteOptions = {},
) {
  if (!authenticate && !LOOPBACK.includes(config.listen.host)) {
    throw new Error(
      'Without authentication the hosted entry listens on loopback only.',
    );
  }

  const record = (entry: Record<string, unknown>) => {
    const full = { time: new Date().toISOString(), ...entry };
    if (log) {
      log(full);
    } else {
      process.stderr.write(
        `${scrubSecrets(JSON.stringify(full), config.secrets)}\n`,
      );
    }
  };
  const perEndpoint = createLimiter(
    config.rate.perEndpoint,
    config.rate.windowMs,
  );
  const perClient = createLimiter(config.rate.perClient, config.rate.windowMs);
  const refuse = (
    res: ServerResponse,
    status: number,
    reason: string,
    client?: string,
    headers: Record<string, string> = {},
  ) => {
    record({ event: 'refused', reason, status, ...(client ? { client } : {}) });
    send(res, status, headers);
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const endpoint = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (!config.allowedHosts.includes(hostName(req.headers.host))) {
      return refuse(res, 403, 'host');
    }
    const origin = req.headers.origin;
    if (
      origin !== undefined &&
      !config.allowedOrigins.includes(origin.toLowerCase())
    ) {
      return refuse(res, 403, 'origin');
    }
    if (!perEndpoint(endpoint)) {
      return refuse(res, 429, 'rate-endpoint', undefined, {
        'retry-after': '60',
      });
    }

    let client = 'anonymous';
    if (authenticate) {
      const who = await authenticate(req);
      if (!who) return refuse(res, 401, 'unauthenticated');
      client = who.clientId;
    }
    if (!perClient(`${endpoint}|${client}`)) {
      return refuse(res, 429, 'rate-client', client, { 'retry-after': '60' });
    }

    if (endpoint !== '/mcp') return refuse(res, 404, 'path', client);
    if (req.method !== 'POST') {
      return refuse(res, 405, 'method', client, { allow: 'POST' });
    }

    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      return refuse(res, 400, 'body', client);
    }

    // Stateless: a fresh server and transport per request, nothing kept.
    const mcp = createServer(config.secrets, {
      registerExtra: registerSyncStatusTool,
      // Name and outcome only: arguments and results can hold budget data.
      onToolCall: (tool, status) =>
        record({ event: 'tool_call', tool, status, client }),
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  return http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500);
      else res.end();
    });
  });
}
