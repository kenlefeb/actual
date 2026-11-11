# Tasks

Test-first: write each test, run it and see it fail before the code.

## 1. Missing blobs and stale cache (sc-2538)

- [x] 1.1 Add failing tests to `packages/loot-core/src/server/encryption/app.test.ts` (key change with a missing document) and `packages/loot-core/src/server/attachments/app.test.ts` (stale cache on open); run them and see them fail.
- [x] 1.2 Implement in `packages/loot-core/src/server/attachments/app.ts`.
- [x] 1.3 Run `yarn lint:fix`, `yarn typecheck` and the loot-core tests; add a release note.

## 2. Only the sync server's "not found" skips a document; stale cache on key change (sc-3371)

- [x] 2.1 Add failing tests: a 404 with another body stops the key change and restores; a stale cached copy does not block the key change. Run them and see them fail.
- [x] 2.2 Add one shared load helper (cached copy, else download once after a decrypt failure) used by open and by the key change; keep `decrypt-failed` and `download-failed` distinct.

## 3. Sync server answers 404 only for a missing file (sc-3380)

- [x] 3.1 Add a failing sync-server test: an unreadable document answers 500, not 404 `attachment-not-found`; add a client test that a 500 stops the key change and restores.
- [x] 3.2 Implement in `packages/sync-server/src/app-sync.ts`: 404 `attachment-not-found` only for ENOENT, 500 otherwise.
