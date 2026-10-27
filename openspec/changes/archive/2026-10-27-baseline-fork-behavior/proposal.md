# Proposal

## Why

The fork already ships product behavior that upstream Actual 26.10.0 lacks (commits `a47437f`, `ddef139`, `3b1a54d`, `4039c27`), but none of it is captured as a durable contract. Recording it as baseline specs protects it during upstream merges and gives each planned upstream contribution a clear behavioral scope.

## What Changes

- Record existing fork behavior as specs; no application code changes.
- API transaction update and delete calls complete before returning and preserve unmentioned split fields.
- Transaction notes keep line breaks on desktop and mobile, with a multiline desktop editor.
- Editing one split on mobile leaves its parent and sibling splits unchanged.
- External links in mobile notes open directly without entering the transaction editor.
- Narrow layouts show a persistent sync status line and sync control.
- Out of scope: fork versioning, release-note and build-provenance rules (kept in `AGENTS.md` and `actual-hosting`); untested claims (desktop Enter navigation, sync status wording) get follow-up tests in a later change.

## Capabilities

### New Capabilities

- `api-transaction-mutations`: completion, error propagation and partial-update semantics of the public API's transaction update and delete calls.
- `transaction-notes`: multiline transaction note entry, display and preservation across desktop and mobile.
- `split-transaction-editing`: isolation of edits between a split parent and its child transactions in the mobile editor.
- `mobile-note-links`: behavior of external links shown in mobile transaction notes.
- `mobile-sync-status`: the persistent synchronization status and control on narrow layouts.

### Modified Capabilities

None.

## Impact

- Documentation only: adds `openspec/specs/` entries describing code already on `development`.
- Code covered: `packages/loot-core/src/server/api.ts`, mobile and desktop transaction note editors, `MobileLinkedNotes`, `MobileSyncStatus`, `SyncRefresh`, `useSyncStatus`.
- Evidence: unit tests in `loot-core`, `api` and `desktop-client`, plus `e2e/mobile-receipts.mobile.test.ts`.
