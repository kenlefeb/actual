# Design

## Context

See proposal.md and `specs/transaction-attachments/spec.md`. What the approach depends on (from the Explore, sc-2622 comment 3232):

- `addAttachment` (`loot-core/src/server/attachments/app.ts`) detects the type from bytes, checks the server's `/info` size limit, resolves the owner (`parent_id ?? transactionId`), encrypts, uploads, and only then inserts the row inside `runMutator(withUndo(...))`. It needs a saved transaction, since it reads `db.getTransaction`.
- The add form works on a temp row (`'temp'` on the phone, `NewTransaction` on desktop). The real id is minted at save by `realizeTempTransactions` (`loot-core/src/shared/transactions.ts`), which returns `[parent, ...children]`.
- Phone: `onConfirmSave` calls `onSave(...)` then `navigate(-1)` without awaiting, so the Documents section unmounts. Desktop: the add row stays mounted for "Add" and resets for the next entry.

## Goals / Non-Goals

**Goals:**
- No orphan documents by construction; cancel and discard need no cleanup.
- Reuse the existing validation, encryption, upload and row insert.

**Non-Goals:**
- An offline upload queue; opening a held file; changing saved-transaction attachments.

## Decisions

### 1. Hold on the client, attach after save
- Files stay in memory until the transaction saves, then `transaction-attachment-add` runs on the realized parent id (`[0].id`). Nothing is stored remotely before then.
- *Rejected:* upload first and record the row at save (cancel, a crash or a closed tab leave blobs against the 1 GB quota and need a server sweep); create the transaction first (half-added transactions are visible, synced and rule-run if the user cancels).

### 2. Validate-only check at pick time (sc-3234)
- A new handler runs the same type-by-bytes, size-limit and sync-server checks as `addAttachment` and returns the same error codes, without encrypting or uploading. `addAttachment` calls the shared checks so the two can't drift. The size limit needs `/info`, so offline the check fails with the existing connection message, which is how the pick is refused offline. The server still checks every upload.
- The new handler gets a `packages/mcp/coverage.json` line (tool or skip with a reason, per the checklist).

### 3. Attach loop lives in the owner of the save
- Phone: the loop runs in `TransactionEdit`'s save flow (where `onSave` and `isAdding` are handled), not in the Documents section. Desktop: in the `onAdd` path of `TransactionsTable.tsx`; the held files reset when the row resets after Add, and on Add and close or cancel.
- Each document attaches in turn. A failure does not stop the rest and does not undo the save; the user gets one message naming the files not attached (the existing "document wasn't attached" wording).

### 4. Shared pending-documents hook
- A hook in `desktop-client` holds the pending files (name, type, size, bytes), the count, add (calls the check), remove and clear, enforces the cap of 5, and accepts initial files so sc-2640 can start with a photo already held. Phone and desktop both use it. The phone's camera and Photos paths (sc-2523) feed it; the HEIC-to-JPEG conversion happens before the check, as today.

### 5. Limit: 5 documents per add
- With 10 MB per file, memory is bounded at about 50 MB. At the cap the control says the limit is reached and adds nothing.

### 6. Undo: two steps
- The add and each attach are separate `withUndo` steps (the existing behavior). Undoing the attach leaves the transaction. If the Solution Architect finds this awkward in review, one step is acceptable and this design is updated first.

### 7. Desktop add-row control
- A paperclip button in the action cluster next to Add, with a count badge once files are held; the register's columns don't change. Held files are listed under the row, each with Remove. Hidden for Schedule (no transaction to attach to). The UX Designer confirms on the sc-3236 PR.

### 8. Splits
- Held documents belong to the add as a whole and attach to the parent. On the phone the Documents section stays on the parent form, not per split line.

## Risks / Trade-offs

- Held files are lost if the app closes before save. Accepted: a pending document is not a saved one.
- The attach runs after the save, so a lost connection leaves a saved transaction without the document. Accepted by the PO; the user is told and can attach later.

## Open Questions

- none (all answered in sc-2622 comment 3237).
