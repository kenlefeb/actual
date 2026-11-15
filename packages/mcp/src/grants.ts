import { createHash } from 'crypto';
import {
  accessSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from 'fs';
import type { Stats } from 'fs';
import { dirname } from 'path';

import { z } from 'zod';

/** What a connection may do, by area. A deleting tool needs its area's write scope and `delete`. */
export const SCOPES = [
  'budget:read',
  'transactions:write',
  'budget:write',
  'structure:write',
  'schedules:write',
  'delete',
] as const;

export type Scope = (typeof SCOPES)[number];

/** A connection's effective grant. `fingerprint` (hosted only) identifies the grants file it came from. */
export type Grant = {
  scopes: Scope[];
  confirm_destructive: boolean;
  max_rows?: number;
  /** A row may set `allow_reconciled` to change a reconciled transaction. Off when absent. */
  allow_reconciled?: boolean;
  fingerprint?: string;
};

/** Parses a space-separated scope list, refusing (fixed text) a name that is not a scope. */
export function parseScopes(text: string): Scope[] {
  const names = text.split(/\s+/).filter(Boolean);
  if (!names.every(n => (SCOPES as readonly string[]).includes(n))) {
    throw new Error(`Unknown scope. Scopes are: ${SCOPES.join(' ')}.`);
  }
  return names as Scope[];
}

const row = z
  .object({
    subject: z
      .string()
      .min(1)
      .refine(s => !s.includes('*')),
    client: z.string().min(1),
    scopes: z.array(z.enum(SCOPES)).min(1),
    confirm_destructive: z.boolean().optional(),
    max_rows: z.number().int().positive().optional(),
    allow_reconciled: z.boolean().optional(),
  })
  .strict();

const grantsFile = z
  .object({ version: z.literal(1), grants: z.array(row) })
  .strict()
  // No pair twice, so a later edit can't silently widen an earlier one.
  .refine(
    f =>
      new Set(f.grants.map(g => JSON.stringify([g.subject, g.client]))).size ===
      f.grants.length,
  )
  // Writes go only to named client ids: `*` covers every future client.
  // It stays read-only in every respect, so no write option either.
  .refine(f =>
    f.grants.every(
      g =>
        g.client !== '*' ||
        (g.scopes.every(s => s === 'budget:read') &&
          g.allow_reconciled === undefined),
    ),
  );

export type GrantRow = z.infer<typeof row>;

/** Validates a grants file (design D3); throws on any violation. */
export function parseGrantsFile(text: string | Buffer): GrantRow[] {
  return grantsFile.parse(JSON.parse(String(text))).grants;
}

const FAIL_CLOSED: Grant = {
  scopes: ['budget:read'],
  confirm_destructive: true,
  fingerprint: 'none',
};

function writable(path: string) {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

class Closed extends Error {}

/**
 * The hosted entry's grant lookup. Every call checks the file (no symlink, not
 * writable by this process, nor its directory), reuses the last good read when
 * mtime, size and inode match, and otherwise reads and hashes it through one
 * descriptor. Anything wrong fails closed to `budget:read`, and each new reason
 * goes to `warn` once (never the file's contents).
 */
export function createGrantsLookup(
  path: string | undefined,
  warn: (reason: string) => void,
) {
  let last: { stat: Stats; rows: GrantRow[]; fingerprint: string } | undefined;
  let lastReason: string | undefined;

  function read() {
    if (!path) throw new Closed('ACTUAL_MCP_GRANTS_FILE is not set');
    let stat: Stats;
    try {
      stat = lstatSync(path);
    } catch {
      throw new Closed('the grants file is missing or unreadable');
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Closed('the grants file is a symlink or not a regular file');
    }
    if (writable(path)) throw new Closed('the grants file is writable');
    // Replacing a file needs only a writable directory.
    if (writable(dirname(path))) {
      throw new Closed('the grants directory is writable');
    }
    if (
      last &&
      last.stat.mtimeMs === stat.mtimeMs &&
      last.stat.size === stat.size &&
      last.stat.ino === stat.ino
    ) {
      return last;
    }
    let fd: number;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      throw new Closed('the grants file is missing or unreadable');
    }
    try {
      const opened = fstatSync(fd);
      if (
        !opened.isFile() ||
        opened.ino !== stat.ino ||
        opened.dev !== stat.dev
      ) {
        throw new Closed('the grants file changed while it was read');
      }
      const bytes = readFileSync(fd);
      let rows: GrantRow[];
      try {
        rows = parseGrantsFile(bytes);
      } catch {
        throw new Closed('the grants file is invalid');
      }
      last = {
        stat: opened,
        rows,
        fingerprint: createHash('sha256')
          .update(bytes)
          .digest('hex')
          .slice(0, 12),
      };
      return last;
    } finally {
      closeSync(fd);
    }
  }

  return (subject: string, client: string): Grant => {
    let file: { rows: GrantRow[]; fingerprint: string };
    try {
      file = read();
      lastReason = undefined;
    } catch (error) {
      const reason =
        error instanceof Closed ? error.message : 'the grants file failed';
      if (reason !== lastReason) {
        lastReason = reason;
        warn(`${reason}; every connection is read-only`);
      }
      return FAIL_CLOSED;
    }
    const mine = file.rows.filter(g => g.subject === subject);
    const match =
      mine.find(g => g.client === client) ?? mine.find(g => g.client === '*');
    return {
      scopes: match?.scopes ?? [],
      confirm_destructive: match?.confirm_destructive ?? true,
      ...(match?.max_rows ? { max_rows: match.max_rows } : {}),
      ...(match?.allow_reconciled ? { allow_reconciled: true } : {}),
      fingerprint: file.fingerprint,
    };
  };
}
