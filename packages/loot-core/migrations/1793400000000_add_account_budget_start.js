// Idempotent: a renumbered upstream copy may run on budgets that already have
// the columns (docs/adr/0004)
export default async function runMigration(db) {
  const columns = db
    .runQuery('PRAGMA table_info(accounts)', [], true)
    .map(column => column.name);
  for (const name of ['budget_start_date', 'budget_start_offset']) {
    if (!columns.includes(name)) {
      db.execQuery(`ALTER TABLE accounts ADD COLUMN ${name} INTEGER;`);
    }
  }
}
