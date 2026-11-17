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
      maxReconcileRows: 500,
      reconcileCeiling: 1000,
      auditTailBytes: 2 * 1024 * 1024,
      maxAuditLineBytes: 512 * 1024,
      maxResponseBytes: 100_000,
      responseBytesCeiling: 1_000_000,
      statementMaxAgeHours: 168,
      statementMaxAgeHoursCeiling: 720,
      statementClockSkewMinutes: 5,
      statementClockSkewMinutesCeiling: 60,
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

  it('The audit line limit follows the tail and can be set', () => {
    expect(
      loadLimits({ [`${STDIO}AUDIT_TAIL_BYTES`]: '4194304' }, STDIO)
        .maxAuditLineBytes,
    ).toBe(1024 * 1024);
    expect(
      loadLimits({ [`${STDIO}MAX_AUDIT_LINE_BYTES`]: '1000' }, STDIO)
        .maxAuditLineBytes,
    ).toBe(1000);
    expect(() =>
      loadLimits({ [`${STDIO}MAX_AUDIT_LINE_BYTES`]: '600000' }, STDIO),
    ).toThrow(/MAX_AUDIT_LINE_BYTES.*AUDIT_TAIL_BYTES/);
  });

  it('The response size is a setting with a ceiling', () => {
    expect(
      loadLimits({ [`${STDIO}MAX_RESPONSE_BYTES`]: '300000' }, STDIO)
        .maxResponseBytes,
    ).toBe(300000);
    expect(() =>
      loadLimits({ [`${STDIO}MAX_RESPONSE_BYTES`]: '1000001' }, STDIO),
    ).toThrow(/MAX_RESPONSE_BYTES is above .*MAX_RESPONSE_BYTES_CEILING/);
    expect(
      loadLimits(
        {
          [`${STDIO}MAX_RESPONSE_BYTES`]: '2000000',
          [`${STDIO}MAX_RESPONSE_BYTES_CEILING`]: '2000000',
        },
        STDIO,
      ).maxResponseBytes,
    ).toBe(2000000);
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

  it('The reconcile limit is a setting with a ceiling and a tail term', () => {
    expect(
      loadLimits({ [`${STDIO}MAX_RECONCILE_ROWS`]: '700' }, STDIO)
        .maxReconcileRows,
    ).toBe(700);
    expect(() =>
      loadLimits({ [`${STDIO}MAX_RECONCILE_ROWS`]: '1001' }, STDIO),
    ).toThrow(/MAX_RECONCILE_ROWS is above .*MAX_RECONCILE_ROWS_CEILING/);
    expect(() =>
      loadLimits({ [`${STDIO}MAX_RECONCILE_ROWS`]: 'x' }, STDIO),
    ).toThrow(/MAX_RECONCILE_ROWS must be a positive whole number/);
    // 4 writes of 6,000 rows at 100 bytes is 2.4 MB: above the 2 MB tail
    expect(() =>
      loadLimits({ [`${STDIO}MAX_RECONCILE_ROWS_CEILING`]: '6000' }, STDIO),
    ).toThrow(/MAX_RECONCILE_ROWS_CEILING.*AUDIT_TAIL_BYTES/);
    expect(
      loadLimits(
        {
          [`${STDIO}MAX_RECONCILE_ROWS_CEILING`]: '6000',
          [`${STDIO}AUDIT_TAIL_BYTES`]: String(4 * 6000 * 100),
        },
        STDIO,
      ).reconcileCeiling,
    ).toBe(6000);
  });

  it('The statement balance expiry and clock skew are settings with ceilings', () => {
    const l = loadLimits(
      {
        [`${STDIO}STATEMENT_BALANCE_MAX_AGE_HOURS`]: '24',
        [`${STDIO}STATEMENT_BALANCE_CLOCK_SKEW_MINUTES`]: '10',
      },
      STDIO,
    );
    expect([l.statementMaxAgeHours, l.statementClockSkewMinutes]).toEqual([
      24, 10,
    ]);
    const wide = loadLimits(
      {
        [`${STDIO}STATEMENT_BALANCE_MAX_AGE_HOURS`]: '800',
        [`${STDIO}STATEMENT_BALANCE_MAX_AGE_HOURS_CEILING`]: '900',
      },
      STDIO,
    );
    expect(wide.statementMaxAgeHours).toBe(800);
    for (const suffix of [
      'STATEMENT_BALANCE_MAX_AGE_HOURS',
      'STATEMENT_BALANCE_CLOCK_SKEW_MINUTES',
    ]) {
      for (const bad of ['0', '1.5', 'x', '-1']) {
        expect(() => loadLimits({ [`${STDIO}${suffix}`]: bad }, STDIO)).toThrow(
          new RegExp(`${suffix} must be a positive whole number`),
        );
      }
    }
    expect(() =>
      loadLimits({ [`${STDIO}STATEMENT_BALANCE_MAX_AGE_HOURS`]: '721' }, STDIO),
    ).toThrow(/STATEMENT_BALANCE_MAX_AGE_HOURS is above .*_CEILING/);
    expect(() =>
      loadLimits(
        { [`${STDIO}STATEMENT_BALANCE_CLOCK_SKEW_MINUTES`]: '61' },
        STDIO,
      ),
    ).toThrow(/STATEMENT_BALANCE_CLOCK_SKEW_MINUTES is above .*_CEILING/);
    // The hosted prefix
    expect(
      loadLimits(
        { ACTUAL_MCP_STATEMENT_BALANCE_MAX_AGE_HOURS: '12' },
        'ACTUAL_MCP_',
      ).statementMaxAgeHours,
    ).toBe(12);
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
