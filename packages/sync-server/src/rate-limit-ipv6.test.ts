import type { Server } from 'node:http';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { app } from './app';

// Tailnet IPv6 addresses differ only in their last 32 bits, so these two
// devices share a /56
const deviceA = 'fd7a:115c:a1e0::1:2345';
const deviceB = 'fd7a:115c:a1e0::6:789a';

// One listening server for the whole file: `request(app)` binds and closes a
// fresh socket per call, which made the 500-request loop slow enough to hit
// the 5 s test timeout on a loaded machine (sc-3660).
let server: Server;

const wrongPassword = (device: string) =>
  request(server)
    .post('/account/login')
    .set('X-Forwarded-For', device)
    .send({ loginMethod: 'password', password: 'wrong' });

describe('rate limits behind the tailnet proxy', () => {
  let trustProxy: unknown;

  beforeAll(async () => {
    server = await new Promise<Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    // As deployed (actual-hosting#36): only the loopback sidecar is trusted
    trustProxy = app.get('trust proxy');
    app.set('trust proxy', ['127.0.0.1/32', '::1/128']);
  });

  afterAll(async () => {
    app.set('trust proxy', trustProxy);
    await new Promise(resolve => server.close(resolve));
  });

  it('gives each IPv6 device its own login limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await wrongPassword(deviceA)).status);
    }
    expect(statuses.at(-1)).toBe(429);

    expect((await wrongPassword(deviceB)).status).toBe(400);
  });

  // Spends the real 500-request allowance, so its cost scales with machine
  // load. The limiter's window is 60 s, so keep the budget well under that or
  // the window would reset mid-test and the 429 would never arrive.
  it(
    'gives each IPv6 device its own share of the request limit',
    {
      timeout: 30_000,
    },
    async () => {
      const deviceC = 'fd7a:115c:a1e0::2:1111';
      const deviceD = 'fd7a:115c:a1e0::3:2222';
      const health = (device: string) =>
        request(server).get('/health').set('X-Forwarded-For', device);
      // Spend the allowance in modest concurrent batches: one at a time is slow
      // under load, all 500 at once resets connections
      for (let sent = 0; sent < 500; sent += 25) {
        await Promise.all(Array.from({ length: 25 }, () => health(deviceC)));
      }
      expect((await health(deviceC)).status).toBe(429);

      expect((await health(deviceD)).status).toBe(200);
    },
  );
});
