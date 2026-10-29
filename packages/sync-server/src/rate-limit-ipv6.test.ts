import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { app } from './app';

// Tailnet IPv6 addresses differ only in their last 32 bits, so these two
// devices share a /56
const deviceA = 'fd7a:115c:a1e0::1:2345';
const deviceB = 'fd7a:115c:a1e0::6:789a';

const wrongPassword = (device: string) =>
  request(app)
    .post('/account/login')
    .set('X-Forwarded-For', device)
    .send({ loginMethod: 'password', password: 'wrong' });

describe('rate limits behind the tailnet proxy', () => {
  let trustProxy: unknown;

  beforeAll(() => {
    // As deployed (actual-hosting#36): only the loopback sidecar is trusted
    trustProxy = app.get('trust proxy');
    app.set('trust proxy', ['127.0.0.1/32', '::1/128']);
  });

  afterAll(() => {
    app.set('trust proxy', trustProxy);
  });

  it('gives each IPv6 device its own login limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await wrongPassword(deviceA)).status);
    }
    expect(statuses.at(-1)).toBe(429);

    expect((await wrongPassword(deviceB)).status).toBe(400);
  });

  it('gives each IPv6 device its own share of the request limit', async () => {
    const deviceC = 'fd7a:115c:a1e0::2:1111';
    const deviceD = 'fd7a:115c:a1e0::3:2222';
    const health = (device: string) =>
      request(app).get('/health').set('X-Forwarded-For', device);
    for (let i = 0; i < 500; i++) {
      await health(deviceC);
    }
    expect((await health(deviceC)).status).toBe(429);

    expect((await health(deviceD)).status).toBe(200);
  });
});
