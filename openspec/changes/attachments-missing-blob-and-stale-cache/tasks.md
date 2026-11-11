# Tasks

Test-first: write each test, run it and see it fail before the code.

## 1. Missing blobs and stale cache (sc-2538)

- [x] 1.1 Add failing tests to `packages/loot-core/src/server/encryption/app.test.ts` (key change with a 404 blob) and `packages/loot-core/src/server/attachments/app.test.ts` (stale cache); run them and see them fail.
- [x] 1.2 Implement in `packages/loot-core/src/server/attachments/app.ts`.
- [x] 1.3 Run `yarn lint:fix`, `yarn typecheck` and the loot-core tests; add a release note.
