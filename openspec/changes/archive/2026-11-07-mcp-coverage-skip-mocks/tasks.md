## 1. Skip mock routes in the coverage scan (sc-1673)

- [x] 1.1 Write failing tests first, named after "A mock route is not a handler": a fixture route under `server/tests/` and one under `__mocks__/` are not found; a real handler elsewhere still is. Run them failing before the fix.
- [x] 1.2 Skip `server/tests/` and `__mocks__/` in `walk` in `fork/scripts/check-mcp-coverage.mjs`.
- [x] 1.3 Rebuild `packages/mcp/upstream-handlers.json` with `--baseline-from upstream/master` (an upstream ref only); review the diff; it comes to 298 handlers. Update the "82 at the time of writing" note only if it changes.
- [x] 1.4 `yarn check:mcp-coverage`, lint, typecheck and tests pass.
