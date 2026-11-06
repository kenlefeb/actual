# Proposal

## Why

The MCP can read categories and set budget amounts, but Ken must open the app to create, rename, move, hide or delete a category or a category group (sc-2598). Hosted MCP is read-write on production ("make it work, harden later", sc-2426), so the gap is now the main reason to leave the assistant. Not urgent unless Ken says so.

## What Changes

- Eight new `write_` tools: `write_create_category_group`, `write_create_category`, `write_update_category_group`, `write_update_category` (rename, hide, unhide), `write_move_category`, `write_move_category_group`, `write_delete_category` and `write_delete_category_group`. Each takes ids, never names, and goes through the write audit log with before and after values.
- `write_delete_category` requires a `transfer_category_id` whenever the category has transactions or budget amounts, and moves them there. It has no dry-run or confirm step (Director decision, 2026-11-05; a later dry-run belongs to sc-2426 or sc-1556).
- `write_delete_category_group` refuses a group that still holds categories; each is deleted (with its own transfer) or moved first.
- Three fork API handlers with typed `@actual-app/api` methods: `api/category-move`, `api/category-group-move` and `api/category-usage-get` (transaction count and budgeted months of one category, for the delete refusal).
- `list_category_groups` also returns each category's `is_income`. Groups and categories already come with ids, `hidden` and the app's order.
- **BREAKING (spec only)**: the `mcp-server` "Write tools" requirement said "no delete tools". Category and category-group delete are now allowed; every other destructive tool stays out (sc-1556).

## Mobile scope

None. The MCP server and the API have no UI, so the desktop-and-mobile rule does not apply: no desktop screen and no screen in `packages/desktop-client/src/components/mobile/` changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: the write tool set, a "Category maintenance tools" requirement, and the category list output.
- `api-fork-handlers`: three more fork handlers with typed methods (17 in total).

## Impact

`packages/mcp` (`tools/write/categories.ts`, `tools/write/register.ts`, `tools/read/core.ts`, tests, `coverage.json`, README), `packages/loot-core/src/server/api.ts` (or the fork handler file beside the other fork handlers), `packages/api/methods.ts` and its handler-list test. Out of scope: rules that name a category (sc-1556), schedules, merging beyond delete-with-transfer, a dry-run for delete, creating or converting income groups.
