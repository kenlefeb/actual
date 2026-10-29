# Proposal

## Why

A phone-only user can set up a paycheck and change a deposit account's days early in the mobile paycheck editor, but cannot choose the account's business calendar. Deposit dates for that account then skip only weekends, so a deposit near a bank holiday shows on the wrong day (Shortcut sc-492). Today the "Business days" dialog opens only from the desktop account menu.

## What Changes

- On narrow layouts, the account menu sheet (opened by tapping the account name on the mobile account page) gets a "Business days" row, behind the existing `businessCalendars` experimental flag.
- The row opens the same "Business days" dialog as desktop: choose a business calendar (or weekends only) and the days early, then save. Validation, the deleted-calendar note and the effect on deposit dates are the desktop ones.
- The dialog's content fits a phone width.

Non-goals: new calendar features, any server or data change, and changing what the desktop dialog does.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `account-business-days`: "Account business calendar" also offers "Business days" from the account menu on narrow (mobile) layouts.

## Impact

- Code: `packages/desktop-client` only: the mobile account menu sheet (`components/modals/AccountMenuModal.tsx`), its `account-menu` modal options (`modals/modalsSlice.ts`), the mobile account page that opens it (`components/mobile/accounts/AccountPage.tsx`), and the width of `components/modals/AccountBusinessDaysModal/`. The `account-set-business-days` server handler and `useSetAccountBusinessDaysMutation` are reused unchanged.
- Data: none.
