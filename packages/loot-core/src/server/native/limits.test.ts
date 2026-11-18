// Fork-only (sc-4643, openspec/changes/native-settings-screen D11). The limits
// registry is the one list of configurable limits: native Settings, web
// Settings and the MCP settings tools all read it, and no handler keeps a
// second copy of a default.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import * as db from '#server/db';
import * as prefs from '#server/prefs';

import { LIMITS, readLimit, readLimits } from './limits';

// D11's table, in order: id, name shown, what it protects, default, ceiling
const D11 = [
  [
    'reconcile-match-max-candidates',
    'Reconcile: rows searched for a match',
    'Keeps matching fast on a large account',
    300,
    2000,
  ],
  [
    'reconcile-match-max-results',
    'Reconcile: matches shown',
    'Keeps the match list short',
    5,
    20,
  ],
  [
    'reconcile-lock-list-max-rows',
    'Reconcile: rows listed when locking',
    'Keeps the lock summary readable',
    200,
    2000,
  ],
  [
    'accounts-register-page-size',
    'Register: rows per page',
    'Keeps the register fast on a large account',
    50,
    200,
  ],
  [
    'accounts-write-max-ids',
    'Register: rows changed at once',
    'Limits how much one tap can change',
    100,
    500,
  ],
  [
    'accounts-register-upcoming-max-days',
    'Scheduled rows: days ahead',
    "Keeps the register's upcoming list bounded",
    92,
    366,
  ],
  // story 4973 (native-register-upcoming-rows D8, D11)
  [
    'accounts-upcoming-max-rows',
    'Scheduled rows: most shown',
    'The most scheduled rows the native register shows and searches (up to 500).',
    100,
    500,
  ],
  [
    'payee-picker-max-results',
    'Payee search: results shown',
    'Keeps payee search fast',
    50,
    500,
  ],
  [
    'payee-search-max-length',
    'Payee search: longest search',
    'Keeps search cheap',
    100,
    200,
  ],
  [
    'payee-name-max-length',
    'New payee: longest name',
    'Keeps payee lists readable',
    200,
    500,
  ],
  [
    'transaction-notes-max-length',
    'Notes: longest note',
    'Keeps each transaction small',
    10000,
    50000,
  ],
  [
    'transaction-split-max-children',
    'Splits: most parts',
    'Keeps a split editable',
    50,
    200,
  ],
  [
    'server-info-timeout-seconds',
    'About: server check wait',
    'Stops About waiting on a dead server',
    5,
    30,
  ],
] as const;

// What the MCP server enforces itself (packages/mcp/src/limits.ts and the
// grant). These stay operator-set and must never become settings.
const MCP_OPERATOR_KEYS = [
  'max_rows',
  'max_cells',
  'max_delete_rows',
  'confirm_destructive',
  'allow_reconciled',
  'scopes',
  'maxRows',
  'maxCells',
  'maxDeleteRows',
  'rowsCeiling',
  'cellsCeiling',
  'deleteCeiling',
  'maxReconcileRows',
  'reconcileCeiling',
  'auditTailBytes',
  'auditLineBytes',
  'maxResponseBytes',
  'responseBytesCeiling',
  'statementMaxAgeHours',
  'statementMaxAgeHoursCeiling',
  'statementClockSkewMinutes',
  'statementClockSkewMinutesCeiling',
  'statement-max-age-hours',
  'statement-clock-skew-minutes',
];

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
});

describe('the limits registry', () => {
  it("equals design D11's list exactly, in order", () => {
    expect(
      Object.entries(LIMITS).map(([id, l]) => [
        id,
        l.name,
        l.help,
        l.default,
        l.ceiling,
      ]),
    ).toEqual(D11.map(row => [...row]));
  });

  it('gives every limit a plain-words name and help line', () => {
    for (const limit of Object.values(LIMITS)) {
      expect(limit.name.trim()).not.toBe('');
      expect(limit.help.trim()).not.toBe('');
    }
  });

  it("holds none of the MCP server's own limits or grant keys", () => {
    for (const key of MCP_OPERATOR_KEYS) {
      expect(Object.hasOwn(LIMITS, key)).toBe(false);
    }
  });

  // No handler keeps a second copy of a limit's default or ceiling
  it('is the only place a limit is declared', () => {
    const dir = __dirname;
    const others = readdirSync(dir)
      .filter(
        f => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'limits.ts',
      )
      .map(f => readFileSync(path.join(dir, f), 'utf8'))
      .join('\n');
    for (const id of Object.keys(LIMITS)) {
      expect(others).not.toMatch(new RegExp(`'${id}':\\s*\\{`));
    }
    expect(others).not.toMatch(/const LIMITS\b/);
  });

  // A setting that does nothing is never shown: `hasReader` is true exactly
  // when engine code calls readLimit for the id. A story that adds the
  // handler flips it in the same PR, and the limit appears in Settings.
  it('marks exactly the limits engine code reads', () => {
    const server = path.join(__dirname, '..');
    const source = (readdirSync(server, { recursive: true }) as string[])
      .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map(f => readFileSync(path.join(server, f), 'utf8'))
      .join('\n');
    const read = Object.keys(LIMITS).filter(id =>
      source.includes(`readLimit('${id}')`),
    );
    expect(
      Object.entries(LIMITS)
        .filter(([, l]) => l.hasReader)
        .map(([id]) => id),
    ).toEqual(read);
  });

  it('reads every limit as value, default and ceiling, in registry order', async () => {
    await db.update('preferences', {
      id: 'accounts-register-page-size',
      value: '120',
    });
    // Out of range or not a whole number: the default
    await db.update('preferences', {
      id: 'accounts-write-max-ids',
      value: '900',
    });
    const limits = await readLimits();
    // Only the limits something reads, in registry order
    expect(limits.map(l => l.id)).toEqual(
      D11.map(([id]) => id).filter(id => LIMITS[id].hasReader),
    );
    expect(limits.find(l => l.id === 'accounts-register-page-size')).toEqual({
      id: 'accounts-register-page-size',
      value: 120,
      default: 50,
      ceiling: 200,
    });
    expect(limits.find(l => l.id === 'accounts-write-max-ids')?.value).toBe(
      100,
    );
    expect(await readLimit('accounts-register-page-size')).toBe(120);
  });
});
