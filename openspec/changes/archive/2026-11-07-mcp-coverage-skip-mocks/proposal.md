## Why

The MCP coverage check treats the mock routes in `loot-core/src/server/tests/mockSyncServer.ts` (`/`, `/sync/sync`, `/gocardless/accounts`) as handlers. They sit in the upstream baseline today, but a mock route the fork adds later would wrongly demand a manifest entry (sc-1673, from the review of sc-1637).

## What Changes

- The coverage scan skips files under `server/tests/` and `__mocks__/`.
- The `mcp-server` "Registration forms" requirement states the skipped paths, with one scenario.
- The baseline is rebuilt from `upstream/master` (298 handlers).

## Impact

`fork/scripts/check-mcp-coverage.mjs`, `packages/mcp/upstream-handlers.json`, `mcp-server` spec. No runtime behavior, no UI (desktop and mobile exempt).
