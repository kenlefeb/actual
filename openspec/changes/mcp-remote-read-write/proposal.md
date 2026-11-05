# Proposal

## Why

Ken wants his assistant to make changes to his real budget through the hosted connector (claude.ai, phone), not only read it (sc-2486). He decided on 2026-11-05 that production is read-write until there are paying customers; hardening (scopes, per-tool limits) is deferred to sc-2426.

## What Changes

- The hosted entry (`actual-mcp-http`) registers the same `write_` tools as the stdio `--writes` entry and opens the engine read-write, on staging and production.
- Each hosted write is audit-logged to `<env>-remote.audit.jsonl`, beside its data directory, with the caller's OAuth subject.
- The production guard keeps its identity checks (the flag, the session token file, the non-ADMIN token, the allowed account, `production-remote`); it no longer implies read-only. The hosted entry still takes no arguments, so `--writes` stays a usage error there.
- The stdio entry no longer refuses `--writes` for a production host that `ACTUAL_MCP_ALLOW_PRODUCTION=1` allows.
- No OAuth change: the `budget:read` scope already admits every tool, so the existing claude.ai connection keeps working.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: production is no longer read-only; the write tools and the audit log cover production and the hosted entry.
- `mcp-remote`: the hosted entry is read-write. Its spec is still in the unarchived `mcp-remote` change, which must archive first.
- `production-identities`: the hosted connector reaches production read-write. Its spec is still in the unarchived `production-identities` change, which must archive first.

## Impact

`packages/mcp` (`remote-config.ts`, `remote.ts`, `config.ts`, tests, README). The hosting compose files work unchanged; their "read-only" comments go stale and are fixed in the hosting repository.
