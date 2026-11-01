# Tasks

## 1. Hide the preview and hint when the start date is unusable (sc-1826)

- [x] 1.1 Spec delta for `account-budget-status` "A cleared or invalid start date". Verify with `openspec validate move-on-budget-cleared-date --strict`.
- [x] 1.2 Add tests in `MoveOnBudgetModal.test.tsx` named after the scenarios, failing first: "Clearing the start date" (no stale numbers, the hint, Move disabled), "An impossible start date" and "Choosing a date brings the preview back"; run them at a narrow width too.
- [x] 1.3 In `MoveOnBudgetModal.tsx`, clear the preview when the date is empty or not a real date (use `isValidYearMonthDay`), show the translated hint "Choose a start date" in its place, and keep Move disabled.
- [x] 1.4 Keep the hint separate from any default-date loading state, so sc-1530 can add its lookup without a flash of the hint (design.md, Decision 4).
- [ ] 1.5 Archive this change when sc-1826 merges, and file Backlog stories for any open follow-up.
