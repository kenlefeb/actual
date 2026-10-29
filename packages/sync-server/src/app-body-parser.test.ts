import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { app } from './app';

let server: ReturnType<typeof app.listen>;
let port: number;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.close();
});

describe('global body parsers', () => {
  // GHSA-27r3-jxmh-p828: body-parser < 2.4.0 throws an uncaught error, taking
  // the process down, when bytes arrive after a gzip body has been decoded.
  it('keeps serving after a gzip body followed by trailing bytes', async () => {
    // Shape from body-parser's own regression test for the advisory.
    const body = Buffer.concat([
      gzipSync('{"a":1}'),
      Buffer.from([0x00]),
      Buffer.alloc(100 * 1024, 0x58),
    ]);
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          port,
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

    // The 2.3.0 crash fires after the response, once the trailing bytes land.
    await new Promise(resolve => setTimeout(resolve, 200));
    const health = await request(app).get('/mode');
    expect(health.status).toBe(200);
  });
});
