BEGIN TRANSACTION;

-- Documents attached to transactions. The document itself lives on the sync
-- server; this row is its metadata. encrypt_meta is NULL when the stored
-- document is not encrypted.
CREATE TABLE IF NOT EXISTS transaction_attachments
  (id TEXT PRIMARY KEY,
   transaction_id TEXT,
   name TEXT,
   mime TEXT,
   size INTEGER,
   sha256 TEXT,
   encrypt_meta TEXT,
   created_at TEXT,
   tombstone INTEGER DEFAULT 0);

COMMIT;
