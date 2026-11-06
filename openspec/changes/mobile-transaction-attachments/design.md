# Design

## Context

See proposal.md (Why). The brief is sc-2523, whose description is settled, including the HEIC decision.

This change is a delta to the `transaction-attachments` capability, which the change `openspec/changes/transaction-attachments/` (sc-2346) adds. That change's spec is merged (PR 218) but its implementation (PR 219) is still open, so the capability isn't in `openspec/specs/` yet. This delta is written against `openspec/changes/transaction-attachments/specs/transaction-attachments/spec.md`. Implementation starts after PR 219 merges, and this change is archived after `transaction-attachments` is archived (sc-2346 Done), so archive applies this delta to the main spec that one creates.

What exists after PR 219, all reused here:

- loot-core handlers `transaction-attachment-add` / `-open` / `-remove` with typed errors (`too-large`, `unsupported-type`, `heic`, `quota`, `needs-sync-server`, `upload-failed`, and an error from `-open` when the document can't be fetched), the client cache, encryption, split-to-parent resolution and undo.
- `packages/desktop-client/src/components/transactions/TransactionAttachments.tsx`: `AttachmentsProvider` (one live query of non-tombstoned rows, grouped by transaction), `useTransactionAttachments(transaction)` (parent's list for a split line), `useAttachDocument()` (hidden `<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp">`, the needs-sync-server check, the refusal messages), and the desktop `openDocument` (new tab, or `window.Actual.openAttachment` in Electron).

The phone screens are `components/mobile/transactions/`: `TransactionEdit.tsx` (one screen edits a transaction and all its split lines; edits stay local until "Save changes"; "Delete transaction" acts at once) and `TransactionList.tsx` / `TransactionListItem.tsx` (a react-aria `ListBox`; the whole row is the press target, with small status icons on its second line).

## Goals / Non-Goals

**Goals:** every attach, indicator, open, remove, undo, split, refusal and offline scenario of `transaction-attachments` on the mobile screens, plus camera and Photos.

**Non-Goals:** loot-core, server, schema or limit changes; export inclusion (sc-2524); blob cleanup (sc-2525); MCP read tool (sc-2526); an in-app camera, scanning, cropping or thumbnails; HEIC conversion; an offline upload queue.

## Decisions

### 1. Reuse the handlers and the desktop hooks unchanged

The phone calls the same three handlers. On the UI side it reuses `AttachmentsProvider`, `useTransactionAttachments` and `useAttachDocument` from `TransactionAttachments.tsx` as they are. The refusal messages therefore have one source and the same wording on both platforms. The only edit to that file is the HEIC string (decision 4).

### 2. Documents section on the edit screen, acting at once

A new component `components/mobile/transactions/TransactionAttachmentsSection.tsx`, rendered in `TransactionEditInner` after Notes and before "Delete transaction", only when `!isAdding` (a temporary id has no row to attach to; the server needs a real transaction id). It renders inside an `AttachmentsProvider` and shows:

- a "Documents" `FieldLabel`;
- one row per document: the name (one line, ellipsis), an Open button and a Remove button (each at least 44 px tall for touch);
- an "Attach document" button calling `attach(transaction.id)` from `useAttachDocument`, plus its hidden `fileInput`.

`transaction` there is the parent (the edit screen of a split shows parent and lines together; opening a line from the list opens that screen), so documents always attach to the parent.

Attach and Remove call the handlers directly and take effect at once, like "Delete transaction". They don't join the screen's pending edits, because the document is uploaded to the server at once and holding it until "Save changes" would need a queue. The live query updates the section and the list.

Alternative rejected: a separate "Documents" page reached from the edit screen. It adds a route and a tap for a list that is usually one or two items.

### 3. One picker for Files, camera and Photos

The phone uses the same hidden input as desktop, with the explicit `accept` list and no `capture` attribute. Without `capture`, iOS and Android show their own sheet with "Photo Library", "Take Photo" and "Choose File" (Android: camera, files, gallery). `capture` would skip the sheet and allow only the camera, so it's left out. One picker means no in-app camera UI (out of scope).

`attach()` calls `input.click()` synchronously from the button's `onPress`. iOS Safari opens a file picker only from a user gesture; react-aria's `onPress` runs in the pointer-up handler, which counts. The Tester confirms the sheet opens on an iPhone (task 6.1). If it doesn't, the Developer renders the input inside a `<label>` styled as the button, which needs no script to open.

### 4. HEIC: explicit types, refusal kept, message changed on both platforms

Evidence (sc-2523): iOS Safari converts a HEIC picture to JPEG when the file input's `accept` lists explicit image types that exclude HEIC (reported by developers on Hacker News, Stack Overflow and Mastering Laravel); with `image/*` it doesn't reliably convert. A camera shot or Photos pick therefore arrives as JPEG with the explicit list that `useAttachDocument` already uses. A HEIC file chosen from the Files app is passed through as is (it's a file, not a Photos item), so the slice-1 HEIC refusal stays and still fires.

Its message changes so the user knows what to do on a phone: "HEIC images aren't supported yet. Choose the photo from your Photos library, or save it as JPEG or PNG, and attach that." This is the one string both platforms share, so the `Accepted types` requirement is modified rather than adding a phone-only message. HEIC conversion in the app stays not planned.

If the Tester finds that a camera photo does not arrive as JPEG (task 6.1), that becomes a question for Ken about adding conversion; it's not decided here.

### 5. Open shows the document inside the app

The desktop `openDocument` opens a blank tab before the fetch and then points it at a `blob:` URL. On a phone that's unreliable: an iOS home-screen web app opens `window.open` in a separate Safari view that can't read the app's `blob:` URLs, and mobile Safari may block or blank such tabs. So the phone does not use it.

Instead, the section's Open:

1. In the Electron app (`window.Actual?.openAttachment` exists; the mobile layout shows in a narrow window), it hands the file to the OS viewer, as desktop does.
2. Elsewhere, it calls `transaction-attachment-open`; on an error it shows "This document can't be loaded right now." (the desktop message); on success it creates an object URL for `new Blob([data], { type: mime })` and opens a new modal, `transaction-attachment-viewer` (`components/modals/TransactionAttachmentViewerModal.tsx`, registered in `modalsSlice.ts` and `Modals.tsx`), passing `{ name, mime, url }`. Only the URL string goes into Redux, not the bytes. The modal revokes the URL when it closes.

The modal is full-screen on the phone, titled with the document name, and shows an `<img>` for JPEG, PNG and WebP, or an `<iframe>` for a PDF. Below it, "Share or save" calls `navigator.share({ files: [file] })` when `navigator.canShare?.({ files: [file] })` is true (iOS and Android share sheets offer Save to Files, Print and other apps); otherwise it's a link with `href={url}` and `download={name}`.

Since the document is fetched before the modal opens, no pop-up blocker is involved.

What the Tester verifies on an iPhone or the iOS simulator, in Safari and in the home-screen app (task 6.1): an image shows; a multi-page PDF shows and scrolls through every page; "Share or save" opens the share sheet with the file and "Save to Files" saves the original. If the iframe shows only the first page of a PDF on iOS, the viewer is still accepted, because the share sheet's preview shows the whole document; the Tester records it on the PR and the Developer adds the line "Use Share or save to see every page." under PDFs.

### 6. Row paperclip is an indicator only

`TransactionList.tsx` wraps its `ListBox` in `AttachmentsProvider`, so every screen that uses the list (account, category, search results) gets one query. `TransactionListItem.tsx` calls `useTransactionAttachments(transaction)` and, when the list is non-empty, shows `SvgAttachment` (11-12 px, `theme.pageTextSubdued`, `aria-label` "Has attached documents") next to the split icon on the row's second line. It is not a button: the row is a react-aria list item whose tap opens the edit screen and whose long press selects, and a nested control there would fight both. The list and actions live on the edit screen.

### 7. Remove with an Undo notification

Phones have no undo shortcut. After `transaction-attachment-remove` succeeds, the section calls `showUndoNotification` from `useUndo` (as the mobile batch actions in `TransactionList.tsx` do) with "Document removed.". Its Undo runs the app's undo, which reverts the tombstone like desktop's Ctrl+Z. The removal doesn't ask for confirmation, because it can be undone and the server keeps the document.

### 8. Offline

Nothing new: `-open` reads the cache first, so a document opened before on this phone opens offline, and one never opened returns the error that shows "can't be loaded right now". `-add` fails with `upload-failed` and the existing message. No queue.

### 9. Mobile e2e with its own sync server

The web e2e suite has no sync server, and attaching needs one. `e2e/transaction-attachments.mobile.test.ts` therefore starts one for its own tests: a helper `e2e/fixtures/sync-server.ts` spawns the sync server (`yarn workspace @actual-app/sync-server start`) with `ACTUAL_PORT` set to a free port and `ACTUAL_DATA_DIR` set to a new temporary directory, waits for `GET /info`, and stops it and deletes the directory after the file's tests. The test connects the app to it with the existing "Connect to a sync server" flow, sets a password, creates a budget, and then works at phone size (390x844, as `mobile-receipts.mobile.test.ts` does). The sync server allows cross-origin requests (`cors()` in `app.ts`), so the app on the e2e port can reach it.

The Fork CI `mobile-e2e` job runs `mobile.test.ts` files inside the dependency Docker image, which already has the sync server's dependencies, so the test runs there with no workflow change. The picker is driven with Playwright's `filechooser` event and a synthetic PDF built in the test (`%PDF-1.4` header and a minimal body); no real document is used.

The same helper can later carry sc-2346's cross-device check (its task 6.1), now Tester-run; that's not part of this change.

## Risks / Trade-offs

- [iOS doesn't convert a camera or Photos HEIC to JPEG on some version] → The HEIC refusal still protects the server; the message tells the user what to do; the Tester's check raises it with Ken.
- [PDF iframe shows one page on iOS] → "Share or save" opens the full document; accepted, see decision 5.
- [`input.click()` from `onPress` blocked on iOS] → The `<label>` fallback in decision 3.
- [A full attachments query per list screen] → One small table, already queried the same way on desktop; fine at receipt volumes.
- [e2e test that spawns a server is slower and can leak a process] → The helper kills the process in `afterAll` and in a `process.on('exit')` hook; the test uses one worker as the job already does.

## Migration Plan

UI-only. No migration, server or config change. Ships in the next fork alpha after sc-2346. Rollback is reverting the release.

## Open Questions

- none. A camera photo that isn't converted to JPEG on a real iPhone would become a question for Ken (decision 4).
