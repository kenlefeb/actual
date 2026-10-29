import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { app } from './app';

let server: ReturnType<typeof app.listen>;
let port: number;

beforeAll(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise(resolve => server.close(resolve)));

describe('global body parsers', () => {
  // GHSA-27r3-jxmh-p828: body-parser < 2.4.0 throws an uncaught error, taking
  // the process down, when bytes arrive after a gzip body has been decoded.
  it('rejects a gzip body with trailing bytes without an uncaught error', async () => {
    // Vitest keeps the worker alive on an uncaught error, so collect it here
    // and assert on it instead of on the server still answering.
    const errors: unknown[] = [];
    let onFirstError = (): void => undefined;
    const firstError = new Promise<void>(resolve => (onFirstError = resolve));
    const collect = (error: unknown) => {
      errors.push(error);
      onFirstError();
    };
    process.prependListener('uncaughtException', collect);
    process.prependListener('unhandledRejection', collect);

    try {
      // Shape from body-parser's own regression test for the advisory.
      const body = Buffer.concat([
        gzipSync('{"a":1}'),
        Buffer.from([0x00]),
        Buffer.alloc(100 * 1024, 0x58),
      ]);
      const serverRequestClosed = once(server, 'request').then(([req]) =>
        once(req as IncomingMessage, 'close'),
      );
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          {
            port,
            agent: false,
            method: 'POST',
            path: '/sync/sync',
            headers: {
              'Content-Type': 'application/json',
              'Content-Encoding': 'gzip',
              'Content-Length': body.length,
            },
          },
          res => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 0));
          },
        );
        req.on('error', reject);
        req.end(body);
      });

      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);

      // On 2.3.0 the error ends the wait as soon as it is thrown (the request
      // then never closes). On a fixed version the request closes once every
      // trailing byte is read; a short settle after that covers a decoder that
      // would still report from zlib's thread pool, which has no event to await.
      await Promise.race([
        firstError,
        serverRequestClosed.then(
          () => new Promise(resolve => setTimeout(resolve, 100)),
        ),
      ]);

      expect(errors).toEqual([]);
    } finally {
      process.removeListener('uncaughtException', collect);
      process.removeListener('unhandledRejection', collect);
    }
  });
});
