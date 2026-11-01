// Set once by `init({ readOnly: true })`. In a read-only session the engine
// runs none of the automatic writers (schedule auto-posting, the paycheck
// reconcile and backfill, the periodic budget upload and the parent-id
// repair), so nothing is pushed to the sync server.
let readOnly = false;

export function setReadOnly(value: boolean) {
  readOnly = value;
}

export function isReadOnly() {
  return readOnly;
}
