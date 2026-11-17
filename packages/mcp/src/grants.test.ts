import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { DEFAULT_LIMITS } from '#limits';

import { createGrantsLookup, parseGrantsFile, parseScopes } from './grants';

const SUB = 'auth0|ken';
const CLIENT = 'pre-registered-client';
const WRITE = [
  'budget:read',
  'transactions:write',
  'budget:write',
  'structure:write',
  'schedules:write',
];

function file(grants: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({ version: 1, grants, ...extra });
}

const DAY_ONE = file([
  { subject: SUB, client: '*', scopes: ['budget:read'] },
  {
    subject: SUB,
    client: CLIENT,
    scopes: WRITE,
    confirm_destructive: true,
    max_rows: 10,
  },
]);

let dirs: string[] = [];

/** A grants file in its own directory, both made read-only as on the VPS (`:ro`). */
function installed(text: string, { lockDir = true, lockFile = true } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'actual-mcp-grants-'));
  dirs.push(parent);
  const dir = join(parent, 'grants');
  mkdirSync(dir);
  const path = join(dir, 'grants.json');
  writeFileSync(path, text);
  if (lockFile) chmodSync(path, 0o444);
  if (lockDir) chmodSync(dir, 0o555);
  return { dir, path };
}

/** Replaces the file the way an atomic install on the host does. */
function replace(dir: string, path: string, text: string) {
  chmodSync(dir, 0o755);
  const next = join(dir, 'next.json');
  writeFileSync(next, text);
  chmodSync(next, 0o444);
  renameSync(next, path);
  chmodSync(dir, 0o555);
}

afterEach(() => {
  for (const d of dirs) {
    try {
      chmodSync(join(d, 'grants'), 0o755);
    } catch {
      // already gone
    }
    rmSync(d, { recursive: true, force: true });
  }
  dirs = [];
});

describe('scope names', () => {
  it('rejects an unknown scope name', () => {
    expect(parseScopes('budget:read transactions:write')).toEqual([
      'budget:read',
      'transactions:write',
    ]);
    expect(() => parseScopes('budget:read transactions:everything')).toThrow(
      /Unknown scope/,
    );
    // Fixed text: the unknown value is never echoed.
    expect(() => parseScopes('transactions:everything')).not.toThrow(
      /everything/,
    );
  });
});

describe('Account deletes have their own scope', () => {
  it('the grants file accepts accounts:delete on a named client', () => {
    const rows = parseGrantsFile(
      file([
        {
          subject: SUB,
          client: CLIENT,
          scopes: ['budget:read', 'structure:write', 'accounts:delete'],
        },
      ]),
    );
    expect(rows[0].scopes).toContain('accounts:delete');
  });

  it('a * client with accounts:delete is invalid', () => {
    expect(() =>
      parseGrantsFile(
        file([
          {
            subject: SUB,
            client: '*',
            scopes: ['budget:read', 'accounts:delete'],
          },
        ]),
      ),
    ).toThrow();
  });

  it('the stdio environment accepts accounts:delete', () => {
    expect(parseScopes('budget:read accounts:delete')).toEqual([
      'budget:read',
      'accounts:delete',
    ]);
  });
});

describe('The grants file schema is strict', () => {
  it('accepts the day-one grant', () => {
    expect(parseGrantsFile(DAY_ONE)).toHaveLength(2);
  });

  it('A duplicate pair', () => {
    expect(() =>
      parseGrantsFile(
        file([
          { subject: SUB, client: CLIENT, scopes: ['budget:read'] },
          { subject: SUB, client: CLIENT, scopes: WRITE },
        ]),
      ),
    ).toThrow();
  });

  it('Writes on the wildcard client', () => {
    expect(() =>
      parseGrantsFile(
        file([
          {
            subject: SUB,
            client: '*',
            scopes: ['budget:read', 'transactions:write'],
          },
        ]),
      ),
    ).toThrow();
  });

  it('An unknown key', () => {
    expect(() =>
      parseGrantsFile(
        file([{ subject: SUB, client: CLIENT, scopes: WRITE, admin: true }]),
      ),
    ).toThrow();
    expect(() => parseGrantsFile(file([], { admin: true }))).toThrow();
  });

  it.each([
    ['a wrong version', JSON.stringify({ version: 2, grants: [] })],
    ['not JSON', '{'],
    [
      'an empty scope list',
      file([{ subject: SUB, client: CLIENT, scopes: [] }]),
    ],
    [
      'an unknown scope',
      file([{ subject: SUB, client: CLIENT, scopes: ['budget:everything'] }]),
    ],
    [
      'a wildcard subject',
      file([{ subject: '*', client: CLIENT, scopes: ['budget:read'] }]),
    ],
    [
      'a zero max_rows',
      file([{ subject: SUB, client: CLIENT, scopes: WRITE, max_rows: 0 }]),
    ],
    [
      'a fractional max_rows',
      file([{ subject: SUB, client: CLIENT, scopes: WRITE, max_rows: 1.5 }]),
    ],
    [
      'a string confirm_destructive',
      file([
        {
          subject: SUB,
          client: CLIENT,
          scopes: WRITE,
          confirm_destructive: 'yes',
        },
      ]),
    ],
    [
      'allow_reconciled on the wildcard client',
      file([
        {
          subject: SUB,
          client: '*',
          scopes: ['budget:read'],
          allow_reconciled: true,
        },
      ]),
    ],
    [
      'a string allow_reconciled',
      file([
        {
          subject: SUB,
          client: CLIENT,
          scopes: WRITE,
          allow_reconciled: 'yes',
        },
      ]),
    ],
  ])('rejects %s', (_, text) => {
    expect(() => parseGrantsFile(text)).toThrow();
  });
});

describe('Hosted grants come from a grants file', () => {
  it('A named client gets writes, others read', () => {
    const { path } = installed(DAY_ONE);
    const lookup = createGrantsLookup(path, () => undefined);
    expect(lookup(SUB, CLIENT).scopes).toEqual(WRITE);
    expect(lookup(SUB, 'dynamic-client-1').scopes).toEqual(['budget:read']);
    expect(lookup('auth0|someone-else', CLIENT).scopes).toEqual([]);
  });

  it('carries the options and a fingerprint of the file', () => {
    const { path } = installed(DAY_ONE);
    const grant = createGrantsLookup(path, () => undefined)(SUB, CLIENT);
    expect(grant).toMatchObject({ confirm_destructive: true, max_rows: 10 });
    expect(grant.fingerprint).toMatch(/^[0-9a-f]{12}$/);
  });

  it('A grant change applies on the next call', () => {
    const { dir, path } = installed(DAY_ONE);
    const lookup = createGrantsLookup(path, () => undefined);
    const before = lookup(SUB, CLIENT);
    expect(before.scopes).toContain('transactions:write');
    replace(
      dir,
      path,
      file([{ subject: SUB, client: CLIENT, scopes: ['budget:read'] }]),
    );
    const after = lookup(SUB, CLIENT);
    expect(after.scopes).toEqual(['budget:read']);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });
});

describe('Hosted confirm is on by default', () => {
  it('Absent means on', () => {
    const { path } = installed(
      file([{ subject: SUB, client: CLIENT, scopes: WRITE }]),
    );
    const grant = createGrantsLookup(path, () => undefined)(SUB, CLIENT);
    expect(grant.confirm_destructive).toBe(true);
  });

  it('only an explicit false turns it off', () => {
    const { path } = installed(
      file([
        {
          subject: SUB,
          client: CLIENT,
          scopes: WRITE,
          confirm_destructive: false,
        },
      ]),
    );
    const grant = createGrantsLookup(path, () => undefined)(SUB, CLIENT);
    expect(grant.confirm_destructive).toBe(false);
  });
});

describe('Hosted reconciled override is off by default', () => {
  it('Absent means off', () => {
    const { path } = installed(DAY_ONE);
    const grant = createGrantsLookup(path, () => undefined)(SUB, CLIENT);
    expect(grant.allow_reconciled).toBeUndefined();
  });

  it('only an explicit true turns it on', () => {
    const { path } = installed(
      file([
        { subject: SUB, client: CLIENT, scopes: WRITE, allow_reconciled: true },
      ]),
    );
    const grant = createGrantsLookup(path, () => undefined)(SUB, CLIENT);
    expect(grant.allow_reconciled).toBe(true);
  });
});

describe('Hosted grants fail closed', () => {
  const READ_ONLY = ['budget:read'];

  function expectClosed(path: string | undefined, reason: RegExp) {
    const warnings: string[] = [];
    const lookup = createGrantsLookup(path, r => warnings.push(r));
    const grant = lookup(SUB, CLIENT);
    expect(grant.scopes).toEqual(READ_ONLY);
    expect(grant.fingerprint).toBe('none');
    lookup(SUB, CLIENT);
    // Once per change of reason, not once per call.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(reason);
    // Never the file's contents.
    expect(warnings[0]).not.toContain(SUB);
  }

  it('No grants file', () => {
    expectClosed(undefined, /not set/);
    expectClosed('/nonexistent/grants.json', /missing/);
  });

  it('A grants file the server could rewrite', () => {
    const { path } = installed(DAY_ONE, { lockFile: false });
    expectClosed(path, /grants file is writable/);
  });

  it('A directory the server can write', () => {
    const { path } = installed(DAY_ONE, { lockDir: false });
    expectClosed(path, /grants directory is writable/);
  });

  it('A symlinked grants file', () => {
    const { path } = installed(DAY_ONE);
    const parent = mkdtempSync(join(tmpdir(), 'actual-mcp-grants-link-'));
    dirs.push(parent);
    const link = join(parent, 'grants.json');
    symlinkSync(path, link);
    chmodSync(parent, 0o555);
    try {
      expectClosed(link, /symlink/);
    } finally {
      chmodSync(parent, 0o755);
    }
  });

  it('An invalid file', () => {
    const { path } = installed(
      file([
        { subject: SUB, client: CLIENT, scopes: ['budget:read'] },
        { subject: SUB, client: CLIENT, scopes: WRITE },
      ]),
    );
    expectClosed(path, /invalid/);
  });

  it('logs a reason again after a good read', () => {
    const { dir, path } = installed(DAY_ONE);
    const warnings: string[] = [];
    const lookup = createGrantsLookup(path, r => warnings.push(r));
    expect(lookup(SUB, CLIENT).scopes).toEqual(WRITE);
    replace(dir, path, '{');
    expect(lookup(SUB, CLIENT).scopes).toEqual(READ_ONLY);
    replace(dir, path, DAY_ONE);
    expect(lookup(SUB, CLIENT).scopes).toEqual(WRITE);
    replace(dir, path, '{');
    lookup(SUB, CLIENT);
    expect(warnings).toHaveLength(2);
  });
});

describe('Grant limits', () => {
  const grant = (extra: Record<string, unknown>) =>
    file([{ subject: SUB, client: CLIENT, scopes: WRITE, ...extra }]);

  it('accepts max_cells and max_delete_rows up to the ceilings', () => {
    const rows = parseGrantsFile(
      grant({ max_rows: 1000, max_cells: 2000, max_delete_rows: 1000 }),
    );
    expect(rows[0]).toMatchObject({
      max_rows: 1000,
      max_cells: 2000,
      max_delete_rows: 1000,
    });
  });

  it.each([
    ['max_rows', 1001],
    ['max_cells', 2001],
    ['max_delete_rows', 1001],
    ['max_cells', 0],
    ['max_delete_rows', 1.5],
  ])('Above the ceiling: %s %s is invalid', (key, value) => {
    expect(() => parseGrantsFile(grant({ [key]: value }))).toThrow();
  });

  it('A raised ceiling admits a higher grant', () => {
    expect(() => parseGrantsFile(grant({ max_cells: 3000 }))).toThrow();
    const limits = { ...DEFAULT_LIMITS, cellsCeiling: 3000 };
    expect(
      parseGrantsFile(grant({ max_cells: 3000 }), limits)[0],
    ).toMatchObject({ max_cells: 3000 });
  });

  it('A grant overrides the setting; the lookup carries every limit', () => {
    const { path } = installed(
      grant({ max_rows: 7, max_cells: 8, max_delete_rows: 9 }),
    );
    const got = createGrantsLookup(path, () => undefined)(SUB, CLIENT);
    expect(got).toMatchObject({
      max_rows: 7,
      max_cells: 8,
      max_delete_rows: 9,
    });
  });

  it('The lookup validates against the ceilings it was given', () => {
    const { path } = installed(grant({ max_cells: 3000 }));
    const warned: string[] = [];
    const strict = createGrantsLookup(path, r => warned.push(r));
    expect(strict(SUB, CLIENT).scopes).toEqual(['budget:read']);
    expect(warned).toEqual([
      'the grants file is invalid; every connection is read-only',
    ]);
    const raised = createGrantsLookup(path, () => undefined, {
      ...DEFAULT_LIMITS,
      cellsCeiling: 3000,
    });
    expect(raised(SUB, CLIENT)).toMatchObject({ max_cells: 3000 });
  });
});
