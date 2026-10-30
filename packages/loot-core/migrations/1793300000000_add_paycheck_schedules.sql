BEGIN TRANSACTION;

-- Which paycheck generated each schedule. Each device inserts its own rows,
-- so this survives a concurrent edit that loses the paycheck definition.
CREATE TABLE paycheck_schedules
  (id TEXT PRIMARY KEY,
   paycheck TEXT,
   tombstone INTEGER DEFAULT 0);

COMMIT;
