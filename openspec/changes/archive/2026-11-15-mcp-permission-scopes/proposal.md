# Proposal

## Why

Story sc-4477 (Ken, 2026-11-15): "My agents should be capable of doing everything I can do. Any restrictions should come from permissions, not the capability of the connection." Today the MCP server limits agents in only one way: by which tools it registers. That doesn't scale to full parity with the app (sc-4203). The hosted connector also has a false permission. Its tokens carry only `budget:read`, yet it serves every write tool under that scope.

## What Changes

- **Six scopes.** Each tool declares the scope it needs: `budget:read`, `transactions:write`, `budget:write`, `structure:write`, `schedules:write`, and `delete`. `delete` combines with the area's write scope: a deleting tool needs both.
- **The tool list doesn't depend on the grant.** Every entry registers every tool. A call the grant doesn't cover is refused with fixed text that names the missing scopes. The refusal is recorded in the audit log. A missing permission never surfaces as "tool not found".
- **Grants decide what a connection may do.**
  - **Hosted entry:** a read-only grants file per instance, keyed by OAuth subject and client id.
    - The server re-reads it when it changes, so a grant change takes effect on the next call with no redeploy.
    - Its schema is strict. A duplicate (subject, client) pair makes the whole file invalid. A `*` (any client) grant may hold only `budget:read`, so writes go only to named client ids.
    - It fails closed to `budget:read` when the file is missing, invalid or a symlink, or when the server could rewrite the file or its directory.
    - Client ids do not tell apart agents that share one sign-in. Separating agents needs distinct subjects (sc-2004).
  - **Stdio:** only the `--writes` entry reads `ACTUAL_MCP_WRITES_SCOPES`, from the 1Password Environment "Actual Agents". The read entry always grants `budget:read`, so the two entries can share one env file. On Ken's machine this is a guard rail against a confused agent, not a security boundary.
- **Safeguards are grant options.**
  - `confirm_destructive`: a destructive tool first runs as a dry run that returns a `confirm` value, then runs for real only with that value. The value is bound to the caller and valid for 5 minutes. It is on by default on the hosted entry. It protects only against mistakes, not against a compromised or prompt-injected model, which can run the dry run itself.
  - `max_rows`: a grant can lower the per-call row cap below the fixed 50.
- **Audit lines record the effective scopes.** On the hosted entry they also record a fingerprint of the grant.
- **BREAKING (hosted):** without a grants file the hosted entry is read-only. Production keeps its writes only if its grant is installed before or with the release that ships this change.
- **Migration:**
  - Stdio without `--writes`: `budget:read`, as today. The write tools are listed but refused, and the engine stays read-only.
  - Stdio with `--writes`: defaults to today's write set, which is every write scope plus `delete`.
  - Existing write tools keep their behaviour and only declare scopes.
- **Day-one production grant for Ken's assistant: DECIDED (Ken, 2026-11-15, recorded on sc-4477).**
  - Every scope **except `delete`** until undo (sc-4215) ships, with `confirm_destructive` on and `max_rows` 10, on the pre-registered client id only. `*` holds `budget:read`.
  - Why: the assistant reads bank, payee and notes text that a prompt injection can steer, and nothing can yet reverse a delete.
  - Adding `delete` later changes only the grants file, not this change.

Not in this change: the parity tools themselves (sc-4203's children, sc-1556, sc-4478, sc-4215 undo). Each of those declares its scope from day one under this model.

Mobile scope: none. The MCP server has no UI, so this change is exempt from the desktop and mobile rule.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`:
  - "Read-only unless writes are turned on" is renamed "A grant decides what a connection may do". Every tool is listed; the grant and the engine mode decide.
  - "Core read tools" drops "no write tools unless …", because the grant decides.
  - "Write tools" stops listing the only allowed tools and requires a declared scope on every tool.
  - "Write audit log" adds refused lines and the effective scopes.
  - New requirements:
    - scopes
    - grants per entry
    - a strict grants schema
    - refusal by scope
    - fail-closed grants
    - confirm before destructive writes, on by default on the hosted entry
    - the row cap a grant can lower

## Impact

- **Code:** `packages/mcp/src/server.ts` (the registration wrapper checks the grant), `tools/write/*` (each tool declares its scope and whether it is destructive), `tools/write/shared.ts` (dry run and `confirm` around `loggedWrite`), `audit.ts` (refused lines and scopes), `config.ts` and `remote-config.ts` (`ACTUAL_MCP_WRITES_SCOPES`, `ACTUAL_MCP_GRANTS_FILE`), `remote.ts` (per-call grant lookup), and the README.
- **Hosting (`kenlefeb/actual-hosting`):** the MCP compose template mounts a read-only grants directory, the deploy installs the grants file for staging and production, and CI checks the files against the schema.
- **Review rules:** `docs/agents/team.md` adds the grants files to the Security Analyst's row.
- **Ordering:** `mcp-remote-read-write` (all tasks done) archives before this change, because both modify the same `mcp-server` requirements.
- **Reviews:** the Security Analyst must review the model (sc-4477), and the Product Owner reviews intent.
