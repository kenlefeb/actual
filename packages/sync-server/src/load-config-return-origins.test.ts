// fork: sc-4962
import type { config as loadedConfig } from './load-config';

// load-config reads the environment when it is first imported.
describe('load-config openId.allowedReturnOrigins', () => {
  let config: typeof loadedConfig;
  let warned: string;

  beforeAll(async () => {
    process.env.ACTUAL_OPENID_ALLOWED_RETURN_ORIGINS =
      'https://Budget.example.org/,foo:bar,https://*.example.org';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      ({ config } = await import('./load-config'));
      warned = JSON.stringify(warn.mock.calls);
    } finally {
      warn.mockRestore();
    }
  });

  afterAll(() => {
    delete process.env.ACTUAL_OPENID_ALLOWED_RETURN_ORIGINS;
  });

  it('keeps only the valid entries, normalised', () => {
    expect(config.get('openId.allowedReturnOrigins')).toEqual([
      'https://budget.example.org',
    ]);
  });

  it('logs the dropped entries by index, never by value', () => {
    expect(warned).toContain('entry 1');
    expect(warned).toContain('entry 2');
    expect(warned).not.toContain('foo:bar');
    expect(warned).not.toContain('*.example.org');
  });
});
