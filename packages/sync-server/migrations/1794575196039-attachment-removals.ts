import { getAccountDb } from '../src/account-db';

// fork: sc-2525. Dated removal records that the attachment cleanup job reads.
export const up = async function (): Promise<void> {
  getAccountDb().exec(`
    CREATE TABLE IF NOT EXISTS attachment_removals (
      file_id TEXT NOT NULL,
      attachment_id TEXT NOT NULL,
      marked_at INTEGER NOT NULL,
      PRIMARY KEY (file_id, attachment_id)
    );
    CREATE INDEX IF NOT EXISTS attachment_removals_marked_at
      ON attachment_removals (marked_at);
    CREATE TABLE IF NOT EXISTS budget_removals (
      file_id TEXT PRIMARY KEY,
      marked_at INTEGER NOT NULL
    );
  `);
};

export const down = async function (): Promise<void> {
  getAccountDb().exec(`
    DROP TABLE IF EXISTS attachment_removals;
    DROP TABLE IF EXISTS budget_removals;
  `);
};
