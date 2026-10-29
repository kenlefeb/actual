# Proposal

## Why

On a phone, a paycheck's clearing account carries no paycheck icon and no note, and no warning when it stays above zero after payday. A phone user who opens "Acme Paycheck" while it still holds 2,250.00 sees a balance with no explanation, although the desktop register would say which deposit is missing (Shortcut sc-677).

## What Changes

- On narrow (mobile) layouts, the accounts list shows the paycheck icon next to a clearing account's name, as the desktop sidebar does.
- The mobile account page of a clearing account shows the same note as the desktop register, above the transaction list. It says the account is the clearing account for the paycheck and should return to zero after each payday.
- When the clearing account warning is active, the mobile account page shows the desktop warning text with it: the amount still in the account and each missing deposit.
- Both stay behind the `paychecks` experimental feature, and an ordinary account shows neither.

Non-goals: any change to when the warning fires, hiding the clearing account, and any server or data change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `paychecks`: "Clearing account note" and "Clearing account warning" apply on narrow (mobile) layouts too: the icon on the mobile accounts list, and the note and warning on the mobile account page.

## Impact

- Code: `packages/desktop-client` only. `ClearingAccountIcon` and `ClearingAccountNote` (`components/schedules/ClearingAccount.tsx`) get placed in the mobile accounts list row (`components/mobile/accounts/AccountsPage.tsx`) and on the mobile account page above the transaction list (`components/mobile/accounts/AccountTransactions.tsx`). The clearing status query and its sync invalidation are reused unchanged.
- Data and server: none.
- Overlap: PR #68 (sc-492) edits `components/mobile/accounts/AccountPage.tsx`. This change avoids that file.
