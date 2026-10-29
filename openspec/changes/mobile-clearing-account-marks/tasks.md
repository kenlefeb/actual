# Tasks

## 1. Contract

- [ ] 1.1 Spec delta: "Clearing account note" and "Clearing account warning" on narrow layouts (`specs/paychecks/spec.md`); verify with `openspec validate mobile-clearing-account-marks --strict`

## 2. Mobile accounts list

- [ ] 2.1 Add failing `AccountsPage` tests named after the scenarios. Under "Acme Paycheck is marked on a phone", with `paychecks` on, the "Acme Paycheck" row's accessible name includes `Clearing account for paycheck "Acme"`. Under "Checking is not marked on a phone" and "Not marked with paychecks turned off", the "Checking" row has no label, and with the flag off "Acme Paycheck" has none either. Then render `ClearingAccountIcon` after the name in `AccountListItem` (`components/mobile/accounts/AccountsPage.tsx`); verify the new tests pass

## 3. Mobile account page

- [ ] 3.1 Add failing `AccountTransactions` tests named after the scenarios. "Acme Paycheck is marked on a phone": the note text matches desktop. "Acme Paycheck still holds 2,250.00 after payday on a phone": with a clearing status `isWarning`, balance 225000 and missing deposits to Checking and Savings, the page shows `2,250.00 is still in "Acme Paycheck", waiting on the deposits to Checking and Savings.` "No warning on a phone while imports may still arrive": with `isWarning` false, only the note shows. "Checking is not marked on a phone" and "Not marked with paychecks turned off": neither shows. Then render `ClearingAccountNote` above `TransactionListWithBalances` in `components/mobile/accounts/AccountTransactions.tsx` (after `ReconcilingBanner`); verify the new tests and the existing `ClearingAccount` and `PaycheckRow` tests pass
- [ ] 3.2 On a narrow viewport (375px wide) with `paychecks` on, check that the icon sits after "Acme Paycheck" in the accounts list without pushing the balance off the row, and that the note and the warning line up with the balance row and wrap without sideways scroll. If the padding is off, add the mobile-only `style` override described in design.md and re-run the 3.1 tests

## 4. Integration checks

- [ ] 4.1 Run the mobile accounts, schedules and paycheck tests in desktop-client, `yarn typecheck` and `yarn lint`; all pass

## Workflow follow-up

- Archive the change when sc-677 merges.
- File the phone form save layout story (design.md, Product decisions 5) if the Product Owner agrees.
