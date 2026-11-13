# Tasks

## 1. Spec (sc-2526)

- [x] 1.1 Solution Architect and Product Owner review this change. Verify `npx openspec validate mcp-list-transaction-attachments --strict` and `yarn check:openspec-shortcut` pass.

## 2. MCP read tool (sc-2526)

- [x] 2.1 Write failing tests in `packages/mcp/src/tools/read/attachments.test.ts` for listing, an empty list, no content fields, sanitized names and invalid input. See them fail.
- [x] 2.2 Implement `list_transaction_attachments` and update `packages/mcp/coverage.json`. Verify the tests and `yarn check:mcp-coverage` pass.
