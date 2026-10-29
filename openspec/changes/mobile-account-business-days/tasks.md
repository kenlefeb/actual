# Tasks

## 1. Contract

- [ ] 1.1 Spec delta: "Business days" on narrow layouts (`specs/account-business-days/spec.md`); verify with `openspec validate mobile-account-business-days --strict`

## 2. Mobile account menu

- [ ] 2.1 Add failing tests for `AccountMenuModal`: with `businessCalendars` on, it shows a "Business days" row that pushes the `account-business-days` modal with the account id; with the flag off, the row is absent. Then add the row; verify the new tests pass
- [ ] 2.2 Add a failing test that `AccountBusinessDaysModal` fits a narrow layout (its content is not wider than the modal container) and still saves the calendar and days early. Then change the content width to `width: '100%', maxWidth: 420`; verify the new test and the existing `AccountBusinessDaysModal` tests pass

## 3. Integration checks

- [ ] 3.1 Run the account, business-calendar and paycheck tests in desktop-client, `yarn typecheck` and `yarn lint`; all pass
- [ ] 3.2 On a narrow viewport with the flag on, open an account, tap its name, tap "Business days", change the calendar and days early, save, and confirm the values show when the dialog is reopened

## Workflow follow-up

- Archive the change when sc-492 merges.
