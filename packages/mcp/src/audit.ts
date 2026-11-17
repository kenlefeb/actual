import { closeSync, fchmodSync, openSync, writeSync } from 'fs';

/** Who acted: the sync-server user id and the OAuth subject (`local` for stdio). Never a token. */
export type Identity = { user_id: string; subject: string };

/** Written on every line: who acted, the scopes the connection held and, on the hosted entry, the grants file fingerprint. */
export type AuditIdentity = Identity & { scopes: string[]; grant?: string };

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
  /** Lines without `schema` are version 1 and not undoable. */
  schema: 2;
  /** The sync id of the loaded budget; an undo refuses a line for another budget. */
  budget_id: string;
  ids: string[];
  changes: AuditChange[];
  /** On a `write_undo` line: the `call_id` of the write it reverses. */
  undoes?: string;
};

/** The outcome line, appended after a write; shares `call_id` with the attempt. */
export type OutcomeEntry = {
  tool: string;
  call_id: string;
  phase: 'outcome';
  status: 'ok' | 'failed';
  /** null: the write failed and its state could not be read back. */
  applied: string[] | null;
  failed: string | null;
  created: string[];
  /** Transfer partners still at their old values after a failed write. */
  partners_not_updated?: string[];
  /** `failed` when a failed write's state could not be read back. */
  read_back?: 'failed';
  undoes?: string;
};

/** A call refused by scope; never its arguments, which can hold budget data. */
export type RefusedEntry = {
  tool: string;
  phase: 'refused';
  missing?: string[];
  /** A fixed code for a refused `write_undo`; never budget data. */
  reason?: string;
  undoes?: string;
};

/**
 * Appends one JSON line (time, identity, tool, call id, ids or outcome) to the
 * write audit log, mode 0600. Callers log the attempt before they write, so a throw
 * here stops the write. Entries hold budget ids and values only, never a
 * credential.
 */
export function appendAudit(
  path: string,
  entry: AuditEntry | OutcomeEntry | RefusedEntry,
  identity: AuditIdentity,
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
