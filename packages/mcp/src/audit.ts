import { closeSync, fchmodSync, openSync, writeSync } from 'fs';

/** Who acted: the sync-server user id and the OAuth subject (`local` for stdio). Never a token. */
export type Identity = { user_id: string; subject: string };

export type AuditChange = {
  id: string;
  field: string;
  before: unknown;
  after: unknown;
};

/** The attempt line, appended before a write. */
export type AuditEntry = {
  tool: string;
  call_id: string;
  phase: 'attempt';
  ids: string[];
  changes: AuditChange[];
};

/** The outcome line, appended after a write; shares `call_id` with the attempt. */
export type OutcomeEntry = {
  tool: string;
  call_id: string;
  phase: 'outcome';
  status: 'ok' | 'failed';
  applied: string[];
  failed: string | null;
  created: string[];
};

/**
 * Appends one JSON line (time, identity, tool, call id, ids or outcome) to the
 * write audit log, mode 0600. Callers log the attempt before they write, so a throw
 * here stops the write. Entries hold budget ids and values only, never a
 * credential.
 */
export function appendAudit(
  path: string,
  entry: AuditEntry | OutcomeEntry,
  identity: Identity,
) {
  const line = `${JSON.stringify({ time: new Date().toISOString(), ...identity, ...entry })}\n`;
  const fd = openSync(path, 'a', 0o600); // O_APPEND | O_CREAT
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
}
