# Tasks

## 1. Paychecks flag

- [ ] 1.1 Add the `paychecks` feature flag type, its Settings > Experimental toggle and the derived default (on when `businessCalendars` is on or any paycheck exists); verify with `useFeatureFlag` tests for unset/with-calendars/with-paycheck/explicitly-off
- [ ] 1.2 Turning `paychecks` on also sets `businessCalendars`; gate "Add paycheck", the editor and `PaycheckScheduleNote` on `paychecks` instead of `businessCalendars`; verify with Experimental settings and schedules-page tests, plus the "Hidden when the feature is off" and "Turning on paychecks" scenarios

## 2. Paychecks section on Schedules (desktop and mobile)

- [ ] 2.1 Add a paycheck-membership hook (paycheck schedule ids, clearing account → paycheck) from `usePaychecks()`; verify with a hook test
- [ ] 2.2 Build the Paychecks section: rows ordered by next pay date with net pay and per-deposit account · amount · date, selecting a row opens the editor, empty state with "Add paycheck"; render it on the desktop Schedules page and the mobile schedules page; verify with component tests for the "Next paycheck at a glance", "Open the editor", "Empty state" and feature-off scenarios
- [ ] 2.3 Hide paycheck pay and deposit schedules from the desktop and mobile schedules lists using the membership hook; verify with the "Paycheck schedules are listed once" scenario test
- [ ] 2.4 Add "Show more" (next three occurrences with deposit dates); verify with the "Show more" scenario test
- [ ] 2.5 Add "Skip next paycheck" on the row with a confirmation naming the date, reusing the paycheck skip mutation; verify with the "Confirm before skipping" scenario test
- [ ] 2.6 Show "Skipped: <date>" when the pay schedule's next occurrence was skipped; verify with the "Unpaid leave is visible" scenario test and undo restoring it

## 3. Clearing account marking and warning

- [ ] 3.1 Add a loot-core handler that returns, per clearing account, its paycheck, balance, the latest posted pay date and the deposits not yet linked for it, and whether the warning is active (expected date + 2 business days of the deposit account's calendar passed and balance ≠ 0); verify with server tests for "Missing deposit" and "No warning while imports may still arrive"
- [ ] 3.2 Show the paycheck icon beside clearing accounts in the sidebar (classic and redesigned) and the note/warning at the top of the clearing account's register; verify with sidebar and account component tests for "Marked as a clearing account"
- [ ] 3.3 Show the active warning on the paycheck's row; verify with the "Missing deposit on the row" scenario test

## 4. Editor additions

- [x] 4.1 Make each deposit's business days early editable in the editor, saving through `account-set-business-days` with the "applies to every paycheck depositing to <account>" note; verify with an editor test and a server test for "Change days early in the editor"
- [x] 4.2 Add a loot-core query for year-to-date totals of a paycheck's posted pay transactions (gross, each deduction by name, net) for the current and previous year, and show them in the editor; verify with a server test for "Check against a W-2" (including an edited transaction) and an editor test

## 5. Mobile paycheck editor

- [ ] 5.1 Extract the editor's form state, validation and computed amounts from `PaycheckEditor` into a shared hook, keeping the desktop modal's behavior; verify with the existing `PaycheckEditModal` tests passing unchanged
- [ ] 5.2 Build the mobile paycheck page (create, edit, delete, skip) as one scrolling page with collapsible section summaries and net pay pinned at the bottom, opened from the mobile Paychecks section; verify with mobile component tests for "Set up a paycheck on a phone" and "Net pay stays visible", and a mobile e2e smoke test

## 6. Release

- [ ] 6.1 Update fork release notes and the in-app fork news for the release that ships these slices; verify with `yarn generate:fork-news` and `src/news/forkNews.test.ts`

## Workflow follow-up

- Each numbered group is its own Shortcut story and PR (`fix`/`refine` per the primer); group 1 first, then 2, then 3–5 in any order.
- Archive the change with `/opsx:archive` once every group has merged.
