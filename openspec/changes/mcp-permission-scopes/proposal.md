# Proposal

## Why

Story sc-4477 (Ken, 2026-11-15): "My agents should be capable of doing everything I can do. Any restrictions should come from permissions, not the capability of the connection." Today the MCP server limits agents in only one way: by which tools it registers. That doesn't scale to full parity with the app (sc-4203). The hosted connector also has a false permission. Its tokens carry only `budget:read`, yet it serves every write tool under that scope.

## What Changes

- **Six scopes.** Each tool declares the scope it needs: `budget:read`, `transactions:write`, `budget:write`, `structure:write`, `schedules:write`, and `delete`. `delete` combines with the area's write scope: a deleting tool needs both.
- **The tool list doesn't depend on the grant.** Every entry registers every tool. A call the grant doesn't cover is refused with fixed text that names the missing scopes. The refusal is recorded in the audit log. A missing permission never surfaces as "tool not found".
- **Grants decide what a connection may do.**
  - **Hosted entry:** a read-only grants file per instance, keyed by OAuth subject and client id. The server re-reads it when it changes, so a grant change takes effect on the next call with no redeploy. A missing, unreadable or writable-by-the-server file fails closed to `budget:read`.
  - **Stdio entries:** `ACTUAL_MCP_SCOPES` from the 1Password Environment "Actual Agents".
- **Safeguards are grant options.**
  - `confirm_destructive`: a destructive tool first runs as a dry run that returns a `confirm` value, then runs for real only with that value.
  - `max_rows`: a grant can lower the per-call row cap below the fixed 50.
- **Audit lines record the effective scopes.** On the hosted entry they also record a fingerprint of the grant.
- **BREAKING (hosted):** without a grants file the hosted entry is read-only. Production keeps its writes only if its grant is installed before or with the release that ships this change.
- **Migration:**
  - Stdio without `--writes`: `budget:read`, as today. The write tools are listed but refused, and the engine stays read-only.
  - Stdio with `--writes`: defaults to today's write set, which is every write scope plus `delete`.
  - Existing write tools keep their behaviour and only declare scopes.
- **Day-one production grant for Ken's assistant: PENDING KEN'S CONFIRMATION.** Default: every scope including `delete`, with `confirm_destructive` on and `max_rows` 50. The Director asked Ken on 2026-11-15. A different answer changes only the grants file content, not this change.

Not in this change: the parity tools themselves (sc-4203's children, sc-1556, sc-4478, sc-4215 undo). Each of those declares its scope from day one under this model.

Mobile scope: none. The MCP server has no UI, so this change is exempt from the desktop and mobile rule.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`:
  - "Read-only unless writes are turned on" becomes "A grant decides what a connection may do". Every tool is listed; the grant and the engine mode decide.
  - "Write tools" stops listing the only allowed tools and requires a declared scope on every tool.
  - "Write audit log" adds refused lines and the effective scopes.
  - New requirements: scopes, grants per entry, refusal by scope, fail-closed grants, confirm before destructive writes, and the row cap a grant can lower.

## Impact

- **Code:** `packages/mcp/src/server.ts` (the registration wrapper checks the grant), `tools/write/*` (each tool declares its scope and whether it is destructive), `tools/write/shared.ts` (dry run and `confirm` around `loggedWrite`), `audit.ts` (refused lines and scopes), `config.ts` and `remote-config.ts` (`ACTUAL_MCP_SCOPES`, `ACTUAL_MCP_GRANTS_FILE`), `remote.ts` (per-call grant lookup), and the README.
- **Hosting (`kenlefeb/actual-hosting`):** the MCP compose template mounts a read-only grants directory, and the deploy installs the grants file for staging and production.
- **Ordering:** `mcp-remote-read-write` (all tasks done) archives before this change, because both modify the same `mcp-server` requirements.
- **Reviews:** the Security Analyst must review the model (sc-4477), and the Product Owner reviews intent.
