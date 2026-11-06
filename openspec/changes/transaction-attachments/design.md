# Design

## Context

See proposal.md (Why). The inputs are the Developer explore pass and the PO decisions on sc-2346 (comments 2520 and 2521); this design follows those decisions and does not reopen them.

Today the sync server stores one blob per budget (`POST /sync/upload-user-file` → `user-files/file-<id>.blob`, `packages/sync-server/src/app-sync.ts`), guarded by `requireFileAccess` and `isValidFileId` (`src/util/paths.ts`), with body limits under `upload.*` in `src/load-config.js`. The budget export (`exportBuffer` in `loot-core/src/server/cloud-storage.ts`) zips only `db.sqlite` and `metadata.json`, and the budget upload encrypts with `encryption.encrypt(data, encryptKeyId)`. Nothing stores a document today.

Ken's rule applies: make it work. Production hardening waits for sc-2426, so this slice adds no protection beyond the type, size and access checks.

## Goals / Non-Goals

**Goals:** the slice-1 behavior in the spec, on the desktop register (web build and Electron).

**Non-Goals:** mobile (sc-2523), export inclusion (sc-2524), blob cleanup (sc-2525), MCP or API access (sc-2526), thumbnails, HEIC, an offline upload queue, a quota UI, and per-split-line attachments.

## Decisions

### 1. Metadata in the budget, documents on the server

A new synced table, added by an additive migration (`packages/loot-core/migrations/<ts>_add_transaction_attachments.sql`):

```sql
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
```

- It joins the AQL schema (`server/aql/schema/index.ts`) as `transaction_attachments`, so the UI reads it with a live query and every change syncs as ordinary CRDT messages.
- `encrypt_meta` holds the JSON `meta` that `encryption.encrypt` returns (key id, IV, auth tag). `NULL` means the document is stored unencrypted. That is the "marked unencrypted" flag the PO asked for, and it carries what decryption needs without a format of our own.
- `size` is the plaintext size; `sha256` is of the plaintext, so a later email intake can spot duplicates.
- The document itself never enters the database, so db.sqlite stays small and phones fetch a document only when it's opened.

Alternatives: documents inside SQLite (rejected by the PO: every device downloads every receipt and the 20 MB sync body and 500 MB zip limits come into play); device-only storage (fails "available on another device").

### 2. Three sync-server endpoints

All under the existing `/sync` router, next to the budget-file endpoints, and following their style (ids in headers, `verifyFileExists` then `requireFileAccess`):

| Endpoint | Purpose |
|---|---|
| `POST /sync/upload-attachment` | Body is the raw bytes (`Content-Type: application/actual-attachment`). Headers `x-actual-file-id`, `x-actual-attachment-id`, `x-actual-attachment-encrypted: true|false`. Checks size, type (only when unencrypted), quota; writes the blob. |
| `GET /sync/download-attachment` | Same id headers; streams the blob, 404 when missing. |
| `POST /sync/delete-attachment` | Same id headers; deletes the blob. Used only by the client to roll back an upload whose metadata row couldn't be written (decision 4). Removal by the user never calls it. |

- Path: `user-files/attachments/<fileId>/<attachmentId>.blob`, built by a helper next to the existing one in `src/util/paths.ts` that keeps its prefix check. The attachment id must pass `isValidFileId`, which rules out traversal.
- A dedicated `express.raw` parser for `application/actual-attachment` has a limit of the per-file limit plus 1 MB of headroom for encryption overhead; the handler then checks the exact size (plaintext limit plus the 16-byte GCM tag for encrypted bodies) and returns 413 with the limit in the body.
- Type check: the first bytes must be `%PDF-` (PDF), `FF D8 FF` (JPEG), `89 50 4E 47 0D 0A 1A 0A` (PNG), or `RIFF....WEBP` (WebP). A HEIC file (`ftyp` box with a `heic`/`heix`/`mif1` brand) gets its own error code so the message can name it. The server can't read an encrypted upload, so it checks only the size of those; the client always checks type (decision 3). This is a consequence of the PO's encryption decision, not a change to it.
- Quota: the sum of file sizes in the budget's attachment folder plus the new body, compared with the quota. No index; a directory listing is fine at receipt volumes.
- Config, in `load-config.js` and the config types, under a new `attachments` group: `fileSizeLimitMB` (default 10, env `ACTUAL_ATTACHMENTS_FILE_SIZE_LIMIT_MB`) and `budgetQuotaMB` (default 1024, env `ACTUAL_ATTACHMENTS_BUDGET_QUOTA_MB`).
- The client learns the per-file limit from the existing `GET /info` response, which gains `attachments: { fileSizeLimitMB }`. This keeps the client's pre-check in step with the server's setting without a fourth endpoint.

The sync server does not depend on loot-core, so the magic-byte check is a small function in each package (`loot-core/src/shared/attachments.ts` and `sync-server/src/util/attachments.ts`), each with its own unit test over the same sample headers.

### 3. Client handlers in loot-core

A new `server/attachments/app.ts` registers three handlers:

- `transaction-attachment-add` `{ transactionId, name, data: Uint8Array }`: refuses when the budget has no `cloudFileId` or no server (`needs-sync-server`); checks type by content and size against the `/info` limit; resolves a split line to its parent; encrypts with `encryptKeyId` when set; uploads; then inserts the row in an undoable batch. Returns the row or a typed error (`too-large`, `unsupported-type`, `heic`, `quota`, `needs-sync-server`, `upload-failed`).
- `transaction-attachment-open` `{ id }`: reads the cached blob from `<budgetDir>/attachments/<id>.blob` or downloads and caches it, decrypts when `encrypt_meta` is set, checks nothing else, and returns `{ name, mime, data }`. The cache holds what the server returned (ciphertext for encrypted budgets), so the device copy is no less protected than the server's. It goes through loot-core's `fs`, which is the budget directory on Electron and IndexedDB on the web.
- `transaction-attachment-remove` `{ id }`: sets `tombstone = 1` through the normal undoable update. The blob stays.

Each handler gets a `skip` entry in `packages/mcp/coverage.json` ("No MCP tool yet; the read tool is sc-2526") so `yarn check:mcp-coverage` passes.

### 4. Upload before metadata

The row is written only after the server answers 200. If the row write then fails, the client calls `delete-attachment` once to roll back and reports `upload-failed`. If that delete also fails the blob is orphaned; sc-2525's cleanup deletes blobs with no row. No upload queue: an attach that can't reach the server fails with a message.

### 5. Splits, deletes and merges

- **Splits:** the add handler stores the parent's id when given a child. The UI shows a child's paperclip by looking up attachments for `parent_id ?? id`.
- **Deleting a transaction:** attachment rows are left alone. The UI shows attachments only for live transactions, so they disappear with it and come back on undo, with no second write that undo would have to pair. sc-2525's cleanup must treat attachments of a deleted transaction as orphaned.
- **Merge:** `transactions/merge.ts` updates every `transaction_attachments` row whose `transaction_id` is the dropped id to the kept id, in the same batch as the merge, so one undo reverts both.

### 6. Desktop UI

- "Attach document…" in the transaction selection menu (`SelectedTransactionsButton.tsx`), enabled for exactly one selected transaction. It opens a hidden `<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp">`. When the budget has no sync server it shows a notification that attaching documents needs a sync server instead.
- A paperclip icon on the register row (in the same cell area as the existing row status icons in `TransactionsTable.tsx`) when the live query finds any non-tombstoned attachment. Choosing it opens a popover listing names, each with "Open" and "Remove".
- Open: `URL.createObjectURL(new Blob([data], { type: mime }))` and `window.open` in a new tab. In Electron, a new window from a blob URL needs checking; if it doesn't render, write the file to a temp path and open it with the OS viewer through a small preload bridge next to `openURLInBrowser` in `desktop-electron/preload.ts` (Electron's `shell.openPath`). Task 5.4 settles this.
- Every message goes through `Trans`/`t()`; refusals map the typed errors from decision 3.

### 7. Export notice

`exportBuffer` already leaves documents out, so nothing changes there. The Export section of Settings (`settings/Export.tsx`) gains one sentence: attached documents aren't included in the export. It shows always, not only when attachments exist, which needs no query.

## Risks / Trade-offs

- [Server can't type-check encrypted uploads] → The client always checks; a modified client could store an odd blob in its own budget's folder, bounded by size and quota. Acceptable until sc-2426.
- [Orphaned blobs grow disk use] → Quota counts them; sc-2525 cleans up after 30 days. The production data-volume backup already captures `user-files/`, so backups grow with use.
- [Electron blob window] → Task 5.4 tests it and falls back to the OS viewer.
- [Quota by directory listing is O(files)] → Fine at receipt volumes; revisit if a budget holds thousands.

## Migration Plan

- One additive migration; older clients ignore the new table's messages. The sync server change is additive: three new routes, one new config group with defaults, one new `/info` field.
- No production change is needed to deploy: no hosting, config or secret change; the defaults apply. Rollback is reverting the release; rows already written stay as unused data.

## Open Questions

- none.
