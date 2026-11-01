import { closeSync, fchmodSync, openSync, writeSync } from 'fs';

export type AuditChange = {
  id: string;
  field: string;
  before: unknown;
  after: unknown;
};

export type AuditEntry = {
  tool: string;
  ids: string[];
  changes: AuditChange[];
};

/**
 * Appends one JSON line (time, tool, ids, field changes) to the write audit
 * log, mode 0600. Callers log before they write, so a throw here stops the
 * write. Entries hold budget ids and values only, never a credential.
 */
export function appendAudit(path: string, entry: AuditEntry) {
  const line = `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`;
  const fd = openSync(path, 'a', 0o600); // O_APPEND | O_CREAT
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
}
