# Design

## Context

See proposal.md - Why. The API already has `createCategory`, `updateCategory`, `deleteCategory` (with `transferCategoryId`) and the same four for groups. loot-core has `category-move` and `category-group-move` but no `api/*` handler for them, and its internal `category-transfer-required` check is not exposed. `api/category-group-create` drops `is_income`, so the API can only create expense groups. loot-core's move does not stop a category moving between an income and an expense group. Writes go through `registerWriteTools` and `loggedWrite` (`packages/mcp/src/tools/write/shared.ts`), so the audit log, before/after and the hosted `writes: true` config apply without change.

## Goals / Non-Goals

**Goals:** every category and group operation in the proposal, end to end, with failing tests first. **Non-Goals:** dry-run or confirm for delete, rules, schedules, merging, income group create or convert.

## Decisions

1. **One tool per operation, with `update` covering rename and hide.** `write_update_category` and `write_update_category_group` take `name` and/or `hidden` (at least one). Alternative: separate rename and hide tools; rejected as more surface for the same call.
2. **Income versus expense is fixed by the group.** `write_create_category` takes the kind from its group (never from input). `write_create_category_group` makes expense groups only (the API cannot do more, and the app has one income group). Moves between an income and an expense group are refused by the tool. Deleting the income group is refused.
3. **Move uses a "before" id.** `write_move_category(category_id, group_id, before_category_id?)` and `write_move_category_group(group_id, before_group_id?)`; no `before` id means the end. This matches loot-core's `targetId`. It also reorders within a group (same `group_id`).
4. **Delete asks the usage handler.** `api/category-usage-get` returns `{transactions, months}` for a category (transactions with it as category, and months with a non-zero budgeted amount). The tool refuses with those numbers when the category is in use and `transfer_category_id` is missing. The transfer target must exist, differ from the deleted category and be the same kind. Alternative: call `getBudgetMonth` over many months; rejected as slow and the months are unknown.
5. **Group delete takes one optional transfer.** `write_delete_category_group` takes an optional `transfer_category_id`. It asks the usage handler for every category in the group (hidden ones included). If any is in use and no transfer id is given, it refuses, listing each in-use category with its transaction count and months, and changes nothing. With one, it moves each in-use category's transactions and budgeted amounts to the transfer category, then deletes the categories and the group. The transfer category must exist, be outside the group and be an expense category; the income group is refused. A group with no category in use deletes with no transfer.
6. **Row cap.** Each tool changes one category or group (move may re-sort neighbours; those sort-order changes are not counted or audited as rows). A group delete counts each of its categories as a row in its audit line, so a group with more than 50 categories is refused with fixed text before any audit line, and nothing changes. The group delete writes one attempt and one outcome line naming the group, its categories and the transfer id.
7. **Names are trimmed and checked first.** Empty, longer than 100 characters, or duplicate (categories within a group, groups anywhere, ignoring case) names are refused with fixed text before any audit line, as loot-core would refuse them later with a less clear error.
8. **Fork handlers sit with the other fork handlers** and get `packages/mcp/coverage.json` lines (the move and usage handlers map to the new tools) and typed methods in `methods.ts`.

## Risks / Trade-offs

- Delete without dry-run can move many transactions in one call, and one group delete can move the transactions of up to 50 categories. Guards: the transfer requirement, same-kind check, the audit log (it names the category and transfer id). Accepted until sc-2426.
- A rename audit shows the old name; undoing a delete is not possible from the MCP.
- Sort orders of neighbours change on a move and are not in the audit line; the moved item's own before and after (group, position) are.
