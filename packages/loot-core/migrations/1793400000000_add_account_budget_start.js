// Idempotent: a renumbered upstream copy may run on budgets that already have
// the columns (docs/adr/0004)
export default async function runMigration(db) {
  const columns = db
    .runQuery('PRAGMA table_info(accounts)', [], true)
    .map(column => column.name);
  // The date is a YYYYMMDD integer like transactions.date; the offset is an id
  for (const [name, type] of [
    ['budget_start_date', 'INTEGER'],
    ['budget_start_offset', 'TEXT'],
  ]) {
    if (!columns.includes(name)) {
      db.execQuery(`ALTER TABLE accounts ADD COLUMN ${name} ${type};`);
    }
  }
}
