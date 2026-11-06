# Tasks

## 1. Category maintenance tools (sc-2598)

- [ ] 1.1 Tests first (failing): fork handler tests for `api/category-move`, `api/category-group-move` and `api/category-usage-get`; API test that `moveCategory`, `moveCategoryGroup` and `getCategoryUsage` exist and call them; the fork-handler list test expects 17.
- [ ] 1.2 Tests first (failing): MCP write tests against a fixture budget for each of the eight tools, the refusals (duplicate name, unknown id, name where an id is required, income and expense mix, delete in use without a transfer, bad transfer target, income group delete, group delete with categories in use with and without a transfer, a transfer inside the group, a transfer that is not an expense category, a group with unused categories only, a group over 50 categories), the audit lines with before and after, and `list_category_groups` returning `is_income` on categories.
- [ ] 1.3 Add the three fork handlers and typed API methods; add their `packages/mcp/coverage.json` lines.
- [ ] 1.4 Add `tools/write/categories.ts`, register it in `register.ts`, and extend `list_category_groups`.
- [ ] 1.5 Run lint, typecheck, tests and `yarn check:mcp-coverage`; update the README tool list; add a release note and fork news.
- [ ] 1.6 No mobile or desktop UI work: the change is server-side only (see proposal.md - Mobile scope).
