import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

export const ATTACHMENT_TEMP_PREFIX = 'actual-attachment-';

// Opened attachments are plain copies in the temp folder. Remove them when the
// app quits, and at the next start in case it crashed. Never right after the
// open: the OS viewer may still be reading the file. Synchronous so a quit
// can't cut it short.
export function removeAttachmentTempDirs(tempDir: string): void {
  let entries;
  try {
    entries = readdirSync(tempDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory() && e.name.startsWith(ATTACHMENT_TEMP_PREFIX)) {
      try {
        rmSync(path.join(tempDir, e.name), { recursive: true, force: true });
      } catch {
        // Best effort: a viewer on Windows may still hold the file open.
      }
    }
  }
}
