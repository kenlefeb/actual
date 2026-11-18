# Design

## Facts

Read on origin/development 2645aa42, plus open PRs #433 and #437.

- **Grants and scopes.** `packages/mcp/src/grants.ts` lists the scopes. A grant holds only the scopes it lists, and the grants schema is strict.
- **The MCP server's own limits** come from two places, never from synced preferences:
  - `packages/mcp/src/limits.ts`, read from the environment at start: rows, cells, deletes, reconcile, audit tail and line, response bytes, statement age and clock skew;
  - the grant: `max_rows`, `max_cells`, `max_delete_rows`, `confirm_destructive`, `allow_reconciled` and the scopes.
- **PR #433** (`mcp-undo-moves`) introduces two rules:
  - every write tool is either in the undo table or in a not-undoable table with a reason;
  - two permanent actions always confirm, whatever `confirm_destructive` says.
- **`native-settings-screen`** (PR #437) adds `native/settings` and `native/settings-save`. The save is one engine function, used by every caller and written in one batch. Its closed key list holds the budget preferences and the `LIMITS` ids, and it refuses everything else with `[native:invalid-setting]`.

## D1. The tools

**`get_settings`** (`budget:read`) returns `{prefs, limits}` from the same engine read as `native/settings`.
- `prefs`: the budget preferences.
- `limits`: each limit as `{id, value, default, ceiling}`.
- Nothing else. In particular it returns no server address, encryption state, user, sync state, keys or switches.

**`write_update_settings {changes}`** (`settings:write`) calls the engine's settings-save function directly. It never re-implements the validation.
- The same closed keys apply, and the same refusals: an unknown or invalid key or value refuses the whole call, and nothing changes.
- For a limit, the refusal names its ceiling.

## D2. Closed list and operator limits

- The tool accepts only the keys the engine save accepts.
- No MCP server limit or grant field is, or will be, in `LIMITS`. Those stay operator-set (environment, server configuration, grant), and changing them needs a restart.
- Two tests enforce this:
  - every limit `limits.ts` enforces, and every grant key, is refused by `write_update_settings` and absent from `get_settings`;
  - the `LIMITS` registry and the MCP limits share no id.

This answers the risk Security raised: an agent holding `settings:write` can never raise its own caps.

## D3. Audit, undo and confirm

- **Audit.** The attempt line logs `{key, before, after}` for each key. The line fits the audit-line limit: changes hold only keys from the closed list and numbers or short enum values.
- **Undo.** `write_update_settings` joins the undo table of #433 (`UNDOABLE`).
  - `write_undo` restores every logged before value, in one engine save, while each key still holds its logged after value.
  - If any key differs, the undo refuses with the reason "a setting changed since; nothing restored", and changes nothing.
  - Undo needs `settings:write`.
- **Confirm.** Validation runs first, so a call that would be refused never returns a `confirm`. A valid call that changes `budgetType` (which recalculates the whole budget) or any limit always answers the first call with a dry run and a `confirm`, whatever `confirm_destructive` says.
  - Undoing a `budgetType` change also needs a `confirm`, because it recalculates the budget again.
  - Undoing a limit change needs none: it restores a value the owner already had. This follows #433's rule for permanent actions and the Product Owner's decision on sc-4691.
  - The dry run lists each key's current and new value.
  - Other preference changes follow `confirm_destructive` as usual.

## D4. How a change reaches running code

- Engine limits are read on every call, so a change applies on the next call: in this server, in the apps and in other MCP servers, once synced.
- The MCP server's own limits are unaffected (D2).

## Risks

- **Undo after another device changed a setting** refuses. That is deliberate: settings are last write wins, and undo must not overwrite someone else's change.
- **An agent with `settings:write`** can make the native screens slower (a larger page size, up to the ceiling) or smaller. Ceilings bound it, and Undo and the audit log record it.

## Decisions for Ken

Adding `settings:write` to the production grant (see Impact). Nothing in this change needs it to merge.
