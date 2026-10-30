BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS business_calendars
  (id TEXT PRIMARY KEY,
   name TEXT,
   non_working_days TEXT DEFAULT '[0,6]',
   holidays TEXT DEFAULT '[]',
   exceptions TEXT DEFAULT '[]',
   tombstone INTEGER DEFAULT 0);

COMMIT;
