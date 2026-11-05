# Design

## Context

Ken's decision (sc-2486, 2026-11-05): the hosted connector is read-write, production included, with no new guards. Hardening is sc-2426.

## Decisions

### 1. Reuse the `--writes` registration as is
The hosted entry passes an audit log and the caller's identity (`user_id` and the OAuth `subject`) to `createServer`, which registers the write tools exactly as for the stdio `--writes` entry. The engine opens without `readOnly`, as on that entry.

### 2. Keep the `<env>-remote` data directory
The stdio `--writes` entry has its own `<env>-writes` copy so a write that has not synced yet never sits in a copy a read-only entry opens (a read-only engine never pushes it). The hosted entry already has its own `<env>-remote` copy that no other entry opens, so it needs nothing more. The audit log sits beside it, `<env>-remote.audit.jsonl`, on the same volume (`/data` in the hosting compose files).

### 3. No scope change
Tokens carry `budget:read`, checked once per request; no tool checks a scope. So the write tools work with the existing grant and Ken does not reconnect claude.ai. A `budget:write` scope is hardening, left to sc-2426.

### 4. Order of archiving
`mcp-remote` and `production-identities` are unarchived changes, so their main specs do not exist yet. Archive them before this change, so its MODIFIED and REMOVED deltas apply.
