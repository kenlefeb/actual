# Proposal

## Why

Stories sc-4793 (the record and its handlers) and sc-4800 (the tool uses only the record), both follow-ups to Security's review of PR #392 on sc-4213. `write_reconcile_account` takes a statement balance from the caller and `get_account_reconciliation` returns the app's own cleared balance, so a prompt-injected model can read the figure, pass it back and lock every cleared row; the confirm is the same model answering itself. Ken (2026-11-17, sc-4793 comment 4795): the human supplies the statement balance in the app, pre-filled from the available inputs with its source shown; the MCP tool never supplies it.

The in-app UI is not here: the native reconcile flow is sc-4801 (waits on Figma) and the web and Electron pre-fill fix is sc-4802. This change specifies what they write and what the tool reads.

## What Changes

- **Group 1, sc-4793:** a per-account, synced **statement balance record** `{id, amount, source, as_of, entered_at, entered_by, consumed_at}` kept as a synced preference. Internal handlers to save, read and consume it (the app's only way in); API-visible handlers to read and consume it (the MCP's only way in). Nothing under `api/` can record one. The server stamps `entered_at` and `id`; `consume` is a compare-and-set on the record id. Desktop, web, Electron and phone all use the same record.
- **Group 2, sc-4800:** `write_reconcile_account` drops its `statement_balance` argument and uses only the record. It refuses, with fixed text, when there is none, it is expired, it was consumed, or its source is `cleared`. The dry run, the audit line and the confirm digest carry the record; a verified lock consumes it. `get_account_reconciliation` reports the record's status.
- **Expiry is a setting** (default 168 hours, operator ceiling 720), not a constant.

Mobile scope: none in this change. The record and handlers are client-neutral and the MCP has no UI; the screens are sc-4801 and sc-4802.

Not in this change: the app UI, the pre-fill and source indicator (sc-4801, sc-4802); a pending reconcile request the agent creates (rejected in the Explore; the record gains `requested_at` if wanted); an account-level statement document as a source (Backlog); a grant-level override of the expiry (not planned: one operator setting is enough).

## Capabilities

### New Capabilities

- `reconcile-statement-balance`: the record, the internal and API handlers, expiry and what counts as human-recorded.

### Modified Capabilities

- `mcp-server`: new requirements for the tool taking no statement balance, its refusals, provenance and consume, and the read's record status. Additions only, because the requirements they change ("Reconcile an account" and its neighbours) live in the active change `mcp-reconcile-account` and not yet in the main spec (design D7).
- `api-fork-handlers`: new requirement for the two typed methods; the handler count of the existing requirement is reconciled at archive (design D7).

## Impact

- **Code:** `packages/loot-core/src/server/accounts/` (record helpers and handlers), `packages/loot-core/src/server/api.ts` (`api/account-statement-balance-get`, `-consume`), `packages/api/methods.ts`, `packages/loot-core/src/types/prefs.ts` (the pref key type), `packages/mcp/src/tools/write/reconcile.ts`, `tools/read/reconciliation.ts`, `limits.ts`/`config.ts` (the expiry setting), tests, `coverage.json`, `README.md`.
- **Hosting (own story after the image ships):** the expiry setting names pass through.
- **Reviews:** Tester; Solution Architect; Security Analyst (the gate itself); Product Owner reviews intent; UX Designer for sc-4801 and sc-4802 only.
