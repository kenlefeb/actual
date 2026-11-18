# Tasks

**Tests first:** write the tests, see them fail, then write the code.

**Depends on:** `native-settings-screen` group 1, the engine settings read and save.

## 1. MCP settings tools (sc-4643)

- [ ] 1.1 The `settings:write` scope in `grants.ts` and the grants schema. Write failing tests first:
  - no grant holds the scope unless it lists it;
  - the wildcard client cannot hold it;
  - tool descriptions name it.
- [ ] 1.2 `get_settings` (`budget:read`) on the engine settings read (design D1). Write failing tests first:
  - the preferences, and the limits with defaults and ceilings;
  - no server, user, encryption, sync, key or switch field.
- [ ] 1.3 `write_update_settings` (`settings:write`), calling the engine's settings-save function (design D1). Write failing tests first:
  - closed keys;
  - an out-of-range limit is refused, naming its ceiling;
  - reset with null;
  - a two-key call with one bad key changes nothing;
  - refused by scope and audit-logged.
- [ ] 1.4 The closed-list tests (design D2):
  - every limit `limits.ts` enforces, and every grant key, is refused by `write_update_settings` and absent from `get_settings`;
  - `LIMITS` and the MCP limits share no id.
- [ ] 1.5 Audit and undo (design D3). Write failing tests first:
  - before and after values for each key in the attempt line, within the audit-line limit;
  - `write_update_settings` in the undo table;
  - `write_undo` restores the values, and refuses when a key changed since.
- [ ] 1.6 Always confirm for `budgetType` and limits (design D3). Write failing tests first:
  - with `confirm_destructive` false, the first call is a dry run with a `confirm`;
  - other preference changes follow `confirm_destructive`.
- [ ] 1.7 Update `coverage.json` and `packages/mcp/README.md`. Run `yarn typecheck`, `yarn lint`, the tests, `yarn check:mcp-coverage` and `openspec validate --all --strict`. Security reviews.
- [ ] 1.8 Ask Ken, through the Director, whether to add `settings:write` to the production grant. Don't add it without his approval.

## Workflow follow-up

- Archive when group 1 merges. Then move the story's change link to the archive path.
