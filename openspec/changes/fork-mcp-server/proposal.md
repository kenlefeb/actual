# Proposal

## Why

Ken wants agents to read and, carefully, change his budget through an MCP server that understands the fork's own features (Shortcut sc-1536, umbrella; slices sc-1568 to sc-1573). Community Actual MCP servers can't do that. They wrap the npm `@actual-app/api`, which bundles upstream's loot-core with none of the fork's migrations. ADR 4 says upstream refuses a budget that carries fork migration ids, or opens it blind to business calendars and fails on relative dates. They also have no tools for paychecks, business calendars or move on budget, so we would fork one and then carry its churn and its safety choices. The Explore findings are in the sc-1536 comment of 2026-10-31 (1559); the Security Analyst's v1 requirements are in comment 1553 and become acceptance scenarios here.

Today the fork's handlers are reachable only through the deprecated `internal.send(name, args)` escape hatch. ADR 2 makes that a real gap: the API refuses to edit a schedule a paycheck manages and tells scripts to edit the paycheck, but no API method exists for that.

## What Changes

- **Typed API methods (sc-1568).** `packages/api/methods.ts` gains thin typed wrappers for the 14 fork-only handlers (counted from `app.method(...)` registrations against `upstream/master`, multi-line registrations included): `paychecks-get`, `paycheck-create`, `paycheck-update`, `paycheck-delete`, `paycheck-skip-next`, `paycheck-year-to-date`, `paychecks-clearing-status`, `account-set-business-days`, `account-move-on-budget-preview`, `account-move-on-budget`, `business-calendars-get`, `business-calendar-create`, `business-calendar-update`, `business-calendar-delete`. The CLI can use them too. (The Explore comment and the slice titles say 13; the count is 14.)
- **`packages/mcp` (sc-1569).** A new workspace package built on `@actual-app/api`, patterned on `packages/cli`: a local stdio MCP server with read-only core tools and the Security Analyst's access rules (no listener, credentials from the environment, server allowlist, injection hygiene, 0700 data directory). Tool output has a size cap and pagination.
- **Coverage manifest and CI check (sc-1570).** `packages/mcp/coverage.json` maps every handler and API method to an MCP tool or to a skip with a reason; `yarn check:mcp-coverage` fails in fork CI on an unmapped one. A story-template checklist line prompts the author.
- **Fork read tools (sc-1571).** Paychecks, year-to-date, clearing status, business calendars, schedule dates, account budget status, moved-history classification and a move-on-budget preview.
- **Opt-in write tools with an audit log (sc-1572).** A separate server entry with `--writes`, `write_`-prefixed tools, a small write set with explicit ids and a 50-row cap, before and after values, and a local JSONL audit log. Fixture-budget tests for writes live here.
- **Eighth aligned package (sc-1573).** `@actual-app/mcp` joins the version-aligned release packages, with a check that all eight `package.json` versions agree, docs, the build artifact and a fork release note.

Non-goals (already filed, deferred):
- A remote or HTTP transport (sc-1554).
- A per-budget agent identity through OpenID multi-user mode, and production writes (sc-1555).
- Delete, bulk, import and rule-edit tools (sc-1556).
- Publishing the package to npm, or contributing it upstream.

## Capabilities

### New Capabilities

- `mcp-server`: what the fork's MCP server exposes and how it protects the budget and its credentials.
- `api-fork-handlers`: typed `@actual-app/api` methods for the fork-only handlers.

### Modified Capabilities

- `paychecks`: the API's refusal to edit a paycheck's schedule also names `updatePaycheck` and the paycheck id.
