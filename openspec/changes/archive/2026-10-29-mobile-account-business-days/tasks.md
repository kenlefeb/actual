# Tasks

## 1. Contract

- [x] 1.1 Spec delta: "Business days" on narrow layouts (`specs/account-business-days/spec.md`); verify with `openspec validate mobile-account-business-days --strict`

## 2. Mobile account menu

- [x] 2.1 Add failing tests for `AccountMenuModal`: with `businessCalendars` on and an `onEditBusinessDays` callback, it shows a "Business days" row after "Reconcile" (above "Close account") that calls the callback with the account id; with the flag off, the row is absent. Then add the optional `onEditBusinessDays` option to the `account-menu` modal type, the row, and the `AccountHeader` callback in `mobile/accounts/AccountPage.tsx` that pushes `account-business-days` with `{ accountId }`; verify the new tests pass
- [x] 2.2 Add a test that `AccountBusinessDaysModal` still saves the calendar and days early at narrow width (with `useResponsive` reporting a narrow layout). Add a failing test that at narrow width the calendar select, the days input and the Cancel and Save buttons are at least 40px tall. Then change its content width to `width: '100%', maxWidth: 420`, open it with `presentation="sheet"`, give those controls `minHeight: styles.mobileMinHeight` at narrow width, and interpolate `MAX_DEPOSIT_DAYS_EARLY` in the validation message; verify the new tests and the existing `AccountBusinessDaysModal` tests pass. The phone-width fit itself can't be tested in jsdom, which does no layout; it is checked only by the manual step 3.2

## 3. Integration checks

- [x] 3.1 Run the account, business-calendar and paycheck tests in desktop-client, `yarn typecheck` and `yarn lint`; all pass
- [x] 3.2 On a narrow viewport (375px wide) with the flag on, open an account, tap its name, tap "Business days", and confirm the dialog opens as a bottom sheet and fits the screen with no sideways scroll. Change the calendar and days early, save, and confirm the values show when the dialog is reopened

## Workflow follow-up

- Archive the change when sc-492 merges.
