import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

// load-config reads the environment when it is first imported, so each case
// imports a fresh copy of the app.
async function getInfo() {
  vi.resetModules();
  const { app } = await import('./app');
  return request(app).get('/info');
}

// Re-importing the whole app per case can exceed the 5 s default on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

describe('/info attachments limit', () => {
  afterEach(() => {
    delete process.env.ACTUAL_ATTACHMENTS_FILE_SIZE_LIMIT_MB;
  });

  it('reports the 10 MB default per-file limit', async () => {
    const res = await getInfo();
    expect(res.body.attachments).toEqual({ fileSizeLimitMB: 10 });
  });

  it('reports the limit set by the server', async () => {
    process.env.ACTUAL_ATTACHMENTS_FILE_SIZE_LIMIT_MB = '5';
    const res = await getInfo();
    expect(res.body.attachments).toEqual({ fileSizeLimitMB: 5 });
  });
});
