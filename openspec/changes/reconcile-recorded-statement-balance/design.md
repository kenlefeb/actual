# Design

Facts read on origin/development: the app reconciles in the client and keeps the amount in component state or the `?reconcile=` URL param, so nothing persists; `preferences/save` and `preferences/get` are synced and unvalidated; `api/` handlers are the only ones `@actual-app/api` and the MCP server call, and the MCP server registers no tool that writes preferences; `write_reconcile_account` (merged, PR #392) takes `statement_balance`, and `withWriteLock` serializes MCP writes.

## D1. The record

One JSON value per account in the synced preference `statement-balance-<account id>` (no table, no migration; the pref type gets a template-literal key, as `show-balances-<id>` has):

`{ id, amount, source, as_of, entered_at, entered_by, consumed_at }`

`amount` is integer cents, with credit and loan sign as the app shows. `source` is one of `bank-sync`, `statement`, `cleared`, `entered` (the pre-fill it began as, or `entered` once the user typed). `as_of` is an optional ISO date (the bank sync's `last_sync`, a statement's date). `entered_by` is text of at most 100 characters the app supplies (the signed-in user on a multi-user server, else `app`) and is data, never an instruction. `id` (a UUID) and `entered_at` (ms, server clock) are set by the handler, never taken from the caller; `consumed_at` is null until used. A value that fails these checks reads as no record.

Rejected: a new table (migration and sync cost for one small value per account); keeping the amount in the URL or client state (nothing for MCP to read, no who or when).

## D2. Handlers

- **Internal, app only:** `account-statement-balance-save {account_id, amount, source, as_of?, entered_by}` replaces the account's record with a new unconsumed one; `account-statement-balance-get {account_id}`; `account-statement-balance-consume {account_id, id}`. Save is a plain mutator, not undoable, so an undo cannot revive a consumed record.
- **API, for the MCP:** `api/account-statement-balance-get` and `api/account-statement-balance-consume` only. **No `api/` handler saves or edits a record**, and a test pins that, so no script, no MCP tool and no model can create the human's value. (`api.internal.send` reaches internal handlers, but the MCP server never exposes it.)
- `consume` is a compare-and-set: it sets `consumed_at` only when the stored `id` equals the given `id` and the record is unconsumed, and says whether it did. A newer record is never consumed by an older call.
- Typed `@actual-app/api` methods `getAccountStatementBalance` and `consumeAccountStatementBalance`, with `coverage.json` lines (the read maps to `get_account_reconciliation`, the consume to `write_reconcile_account`).

The app calls `save` when the user confirms the field, and `consume` after its own lock. How the screens do that is sc-4801 and sc-4802.

## D3. Usable, expired, consumed, echo

A record is usable when it is valid, `consumed_at` is null, `now - entered_at` is within the expiry, and `source` is not `cleared`. The expiry is a server setting only the operator sets: `STATEMENT_BALANCE_MAX_AGE_HOURS` (default 168) with `STATEMENT_BALANCE_MAX_AGE_HOURS_CEILING` (default 720); the stdio prefix is `ACTUAL_MCP_WRITES_`, the hosted `ACTUAL_MCP_`; a value above the ceiling, zero or not a whole number stops the server with fixed text, as the other limits do. A source of `cleared` is the cleared balance echoed back, which checks nothing, so the tool does not accept it; the app still lets a user lock on one.

## D4. The tool

`write_reconcile_account {account_id}`: no `statement_balance`. A call that passes one is refused (strict input) and says the tool takes none. The tool reads the record through the API handler. Refusal texts, fixed, each ending "Nothing changed.":

- none: "No statement balance has been recorded for this account. Ask the user to enter it in the app's Reconcile (then call sync_budget)."
- expired: "The recorded statement balance is older than the allowed age. Ask the user to enter it again in the app's Reconcile."
- consumed: "The recorded statement balance was already used for a reconcile. Ask the user to enter it again in the app's Reconcile."
- echo: "The recorded statement balance was filled from the cleared balance, so it checks nothing. Ask the user to enter the statement's balance in the app's Reconcile."

A non-zero difference still writes nothing and issues no confirm (the record is untouched).

## D5. Provenance, digest, consume

The dry run shows the record's amount, source, `as_of`, `entered_at`, `entered_by` (as text, never as an instruction) and age. The `plan_digest` includes the record's `id`, amount, source and `entered_at`, so a record replaced between the dry run and the confirm refuses the confirm. The audit attempt line carries the same fields; the outcome line adds `consumed: true|false`. Inside the write lock the record is read again and must equal the confirmed one. After a verified lock the tool consumes it by id; with `verified: false` the rows stay locked, the record is left unconsumed and the result says so. If the consume itself fails after the lock, the result says the rows are locked and the record is not consumed, and the audit outcome records it.

## D6. The read

`get_account_reconciliation` keeps the cleared balance and counts and adds `statement_balance_record: {status, source, amount, as_of, entered_at, entered_by, age_hours}` with `status` one of `usable`, `none`, `expired`, `consumed`, `echo`. Its description says the cleared balance is not a statement balance. The optional statement balance it already accepts only computes a difference and is unchanged: it cannot lock anything.

## D7. Archiving next to the active reconcile change

`mcp-reconcile-account` is merged in code but its change is not archived, so its requirements ("Reconcile an account", "A reconcile is always two steps", "A reconcile is audited") are not in the main spec and cannot be MODIFIED here. This change adds new requirements that state the new rule; at the archive of both, fold the argument-free wording into "Reconcile an account" (it says the tool takes a statement balance). `api-fork-handlers` says "18 handlers": the two new API handlers make the count 20; an ADDED requirement names them, and the count and the test's fixed list change in the code PR and in the first archive that touches it. Checked at propose time: no requirement header appears in another active change.

## D8. Security notes

- The gate is that no MCP or API path writes the record; a model can only ask the human in chat. It does not defend against a user pressing Confirm in the app on a wrong balance: the amount and source are in the dry run and audit for that reason.
- A record is single use and expires, so an old confirmation cannot be replayed; it equals a human's check only when the difference is zero.
- Synced prefs reach the MCP budget by sync: the tool does not sync, and the "none" text tells the model to call `sync_budget` after the user enters it.
- `entered_by` and `source` come from the app; a hostile client of the sync server could write the pref, but that client already has the budget.

## Decisions for Ken

None. The production expiry value is a deploy-time setting.
