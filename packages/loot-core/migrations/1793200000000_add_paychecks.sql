BEGIN TRANSACTION;

ALTER TABLE accounts ADD COLUMN business_calendar_id TEXT;
ALTER TABLE accounts ADD COLUMN deposit_days_early INTEGER DEFAULT 0;

CREATE TABLE paychecks
  (id TEXT PRIMARY KEY,
   name TEXT,
   definition TEXT,
   tombstone INTEGER DEFAULT 0);

COMMIT;
