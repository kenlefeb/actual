# Tasks

## 1. Contract

- [ ] 1.1 Spec delta: "Clearing account note" and "Clearing account warning" on narrow layouts (`specs/paychecks/spec.md`); verify with `openspec validate mobile-clearing-account-marks --strict`

## 2. Mobile accounts list

- [ ] 2.1 Add failing `AccountsPage` tests named after the scenarios. Under "Acme Paycheck is marked on a phone", with `paychecks` on, the "Acme Paycheck" row's accessible name includes `Clearing account for paycheck "Acme"`. Under "Checking is not marked on a phone" and "Not marked with paychecks turned off", the "Checking" row has no label, and with the flag off "Acme Paycheck" has none either. Then add an optional `size` prop to `ClearingAccountIcon` (default 11, so desktop is unchanged). In `AccountListItem` (`components/mobile/accounts/AccountsPage.tsx`), wrap the name and the icon in a row where the name shrinks (`minWidth: 0`) and the icon doesn't (`flexShrink: 0`), and pass `size` about 14. Verify the new tests and the existing sidebar tests pass

## 3. Mobile account page

- [ ] 3.1 Add failing `AccountTransactions` tests named after the scenarios. "Acme Paycheck is marked on a phone": the note text matches desktop. "Acme Paycheck still holds 2,250.00 after payday on a phone": with a clearing status `isWarning`, balance 225000 and missing deposits to Checking and Savings, the page shows `2,250.00 is still in "Acme Paycheck", waiting on the deposits to Checking and Savings.` "No warning on a phone while imports may still arrive": with `isWarning` false, only the note shows. "Checking is not marked on a phone" and "Not marked with paychecks turned off": neither shows. The warning test also checks that on the phone the warning is its own block, after the note and not inside the note's sentence. Then:
  - add an optional `style` override to `ClearingAccountNote`, and an option that puts the warning on its own line below the note (the desktop defaults are unchanged);
  - render `ClearingAccountNote` above `TransactionListWithBalances` in `components/mobile/accounts/AccountTransactions.tsx` (after `ReconcilingBanner`), with 10px side and vertical padding and the warning on its own line.

  Verify the new tests and the existing `ClearingAccount` and `PaycheckRow` tests pass, including a check that the desktop note still shows the warning in the same sentence
- [ ] 3.2 On a narrow viewport (375px wide) with `paychecks` on, check that:
  - the icon (about 14px) sits right after "Acme Paycheck" in the accounts list and doesn't move the balance;
  - with the clearing account renamed "Acme Paycheck Clearing", the name truncates to "Acme Paycheck Cl…", the icon stays right after it, and the balance is unmoved;
  - the note has 10px side padding, lined up with the search bar;
  - the warning is on its own line below the note, with no sideways scroll.

## 4. Integration checks

- [ ] 4.1 Run the mobile accounts, schedules and paycheck tests in desktop-client, `yarn typecheck` and `yarn lint`; all pass

## Workflow follow-up

- Archive the change when sc-677 merges.
- File the phone form save layout story (design.md, Product decisions 5) if the Product Owner agrees.
