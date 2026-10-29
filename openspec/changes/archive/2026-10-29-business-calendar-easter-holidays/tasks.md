# Tasks

## 1. Evaluation core

- [x] 1.1 Add the `easter` holiday rule variant (with `offset`) to `types/models/business-calendar.ts`, moving `month` to the date-in-month kinds
- [x] 1.2 Add failing tests for `getWesternEaster` (2024, 2025, 2026, 2038, 1818, 2285) and for Easter-relative rules (Good Friday, Easter Monday, observance) in `shared/business-calendars.test.ts`; implement `getWesternEaster` and the `easter` case in `ruleDate`; verify the tests pass

## 2. Server

- [x] 2.1 Add failing tests for accepting an Easter rule and rejecting bad offsets in `server/business-calendars/app.test.ts`; validate `offset` as an integer from -100 to 100 and require `month` only for date-in-month kinds; verify the tests pass

## 3. Desktop UI

- [x] 3.1 Add a failing editor test that switches a rule to "Days from Easter", sets -2, checks the 2026 preview and the saved rule; add the kind and offset input to `BusinessCalendarEditor.tsx` with translated text; verify the test passes

## 4. Integration checks

- [x] 4.1 Run the business-calendar, schedule and paycheck tests in loot-core and desktop-client, `yarn typecheck` and `yarn lint`
