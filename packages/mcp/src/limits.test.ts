import { DEFAULT_LIMITS, loadLimits } from '#limits';

import { loadConfig } from './config';

const STDIO = 'ACTUAL_MCP_WRITES_';
const base = {
  ACTUAL_SERVER_URL: 'http://localhost:5006',
  ACTUAL_PASSWORD: 'hunter2-secret',
  ACTUAL_SYNC_ID: 'sync-1',
};

describe('Limits are configurable defaults', () => {
  it('Defaults', () => {
    expect(loadLimits({}, STDIO)).toEqual({
      maxRows: 50,
      maxCells: 500,
      maxDeleteRows: 50,
      rowsCeiling: 1000,
      cellsCeiling: 2000,
      deleteCeiling: 1000,
      auditTailBytes: 2 * 1024 * 1024,
    });
    expect(DEFAULT_LIMITS).toEqual(loadLimits({}, STDIO));
  });

  it('A setting changes a limit and its ceiling', () => {
    const limits = loadLimits(
      {
        [`${STDIO}MAX_ROWS`]: '200',
        [`${STDIO}MAX_CELLS`]: '1500',
        [`${STDIO}MAX_DELETE_ROWS`]: '20',
        [`${STDIO}MAX_ROWS_CEILING`]: '3000',
        [`${STDIO}AUDIT_TAIL_BYTES`]: String(8 * 1024 * 1024),
      },
      STDIO,
    );
    expect(limits).toMatchObject({
      maxRows: 200,
      maxCells: 1500,
      maxDeleteRows: 20,
      rowsCeiling: 3000,
      auditTailBytes: 8 * 1024 * 1024,
    });
  });

  it('The hosted entry uses its own names', () => {
    const env = { ACTUAL_MCP_MAX_CELLS: '300' };
    expect(loadLimits(env, 'ACTUAL_MCP_').maxCells).toBe(300);
    expect(loadLimits(env, STDIO).maxCells).toBe(500);
  });

  it.each([
    ['MAX_ROWS', '0'],
    ['MAX_CELLS', 'many'],
    ['MAX_DELETE_ROWS', '1.5'],
    ['AUDIT_TAIL_BYTES', '-1'],
    ['MAX_ROWS_CEILING', '0'],
  ])('refuses %s=%j', (name, value) => {
    expect(() => loadLimits({ [`${STDIO}${name}`]: value }, STDIO)).toThrow(
      new RegExp(`${STDIO}${name} must be a positive whole number`),
    );
  });

  it('Above the ceiling', () => {
    expect(() => loadLimits({ [`${STDIO}MAX_ROWS`]: '1001' }, STDIO)).toThrow(
      /MAX_ROWS is above ACTUAL_MCP_WRITES_MAX_ROWS_CEILING/,
    );
    expect(
      loadLimits(
        { [`${STDIO}MAX_ROWS`]: '1001', [`${STDIO}MAX_ROWS_CEILING`]: '1001' },
        STDIO,
      ).maxRows,
    ).toBe(1001);
  });

  it('A ceiling the audit tail cannot hold', () => {
    expect(() =>
      loadLimits({ [`${STDIO}MAX_CELLS_CEILING`]: '5000' }, STDIO),
    ).toThrow(/MAX_CELLS_CEILING.*AUDIT_TAIL_BYTES/);
    // a bigger tail admits it
    expect(
      loadLimits(
        {
          [`${STDIO}MAX_CELLS_CEILING`]: '5000',
          [`${STDIO}AUDIT_TAIL_BYTES`]: String(4 * 5000 * 150),
        },
        STDIO,
      ).cellsCeiling,
    ).toBe(5000);
  });

  it('A row ceiling the audit tail cannot hold', () => {
    expect(() =>
      loadLimits({ [`${STDIO}MAX_ROWS_CEILING`]: '5000' }, STDIO),
    ).toThrow(/MAX_ROWS_CEILING.*AUDIT_TAIL_BYTES/);
  });

  it('The writes entry reads the settings; the read entry never does', () => {
    const env = { ...base, [`${STDIO}MAX_CELLS`]: '123' };
    expect(loadConfig(env, ['--writes']).limits.maxCells).toBe(123);
    expect(loadConfig(env).limits).toEqual(DEFAULT_LIMITS);
    expect(() =>
      loadConfig({ ...base, [`${STDIO}MAX_CELLS_CEILING`]: '5000' }, [
        '--writes',
      ]),
    ).toThrow(/AUDIT_TAIL_BYTES/);
  });

  it('A row setting is a setting, not a grant', () => {
    const config = loadConfig({ ...base, [`${STDIO}MAX_ROWS`]: '10' }, [
      '--writes',
    ]);
    expect(config.limits.maxRows).toBe(10);
    expect(config.grant.max_rows).toBe(undefined);
  });
});
