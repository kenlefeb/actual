# Design

## Context

See proposal.md and specs/account-business-days/spec.md.

- Desktop: `components/accounts/Header.tsx` `AccountMenu` adds a `business-days` item when `useFeatureFlag('businessCalendars')` is on. `components/accounts/Account.tsx` handles it by pushing the `account-business-days` modal (`{ accountId }`), rendered by `components/modals/AccountBusinessDaysModal/`. The dialog saves through `useSetAccountBusinessDaysMutation` (`paychecks/mutations.ts`), which sends `account-set-business-days` (`loot-core/src/server/paychecks/app.ts`, `mutator(undoable(...))`). That handler also moves the account's deposit dates.
- Mobile: on narrow layouts `/accounts/:id` renders `components/mobile/accounts/AccountPage.tsx` (through `NarrowAlternate name="Account"`). So a mobile account page exists, as the story assumes. Its `AccountHeader` shows the account name as a button; tapping it pushes the `account-menu` modal, `components/modals/AccountMenuModal.tsx`. That is a `MobileSheet` of `MobileSheetRow`s: Rename, Edit notes, Reconcile, running balance, reconciled transactions, Close/Reopen. It has no "Business days" row. The "All accounts", on-budget and off-budget pages have a different menu (`all-accounts-menu`) and no single account, so they are out of scope.
- The dialog's content is a `View` with `width: 420`. On a phone the modal container is at most `90vw` (about 340px on a 375px screen), so the dialog would scroll sideways.

## Goals / Non-Goals

**Goals:**
- A phone user can set the calendar and days early for one account, with the desktop dialog's validation and effects.
- One dialog for both layouts, so the rules cannot drift.

**Non-Goals:**
- A full-page mobile editor, new fields, or changes to the server handler or data.
- A "Business days" entry on the all-accounts menus.

## Decisions

### Add a row to the mobile account menu sheet
`AccountMenuModal` adds a "Business days" `MobileSheetRow` when `useFeatureFlag('businessCalendars')` is on, placed after "Reconcile" (near the desktop item's position among account settings). The row pushes the existing `account-business-days` modal with `{ accountId }`, as the desktop handler does. The sheet does this itself instead of taking a new callback from `AccountPage`, because the modal needs only the account id. That matches how the sheet already reads its own synced prefs.

- Alternative: a separate control on the mobile account page itself. Rejected: every other per-account setting on mobile lives in this sheet.

### Reuse the desktop dialog
The row opens `AccountBusinessDaysModal`, not a new mobile page. The dialog has two fields and a Save button, so it fits a phone once its width is fixed. This keeps one implementation of the days validation, the "Missing calendar" note and the save call. Saving closes the dialog and leaves the account menu sheet open underneath, as "Edit notes" does.

- Alternative: a full mobile page like the paycheck editor (sc-60). Rejected for now: it would duplicate the validation for two fields.

### Make the dialog width responsive
Change the content `View` from `width: 420` to `width: '100%', maxWidth: 420`. On desktop the modal container is at least `breakpoint_small` wide, so the content stays 420px and the desktop dialog looks the same. On a phone it fills the container. No other desktop change.

### Feature flag
Only the row is gated, as on desktop. The modal itself is not reachable from mobile without the row.

## Decisions for Ken

- **Entry point is the account menu sheet** (tap the account name), next to Rename, Edit notes and Reconcile. No new control on the account page.
- **Reused the desktop dialog** instead of building a mobile page. Same validation by construction; the layout is the desktop one at phone width.
- **No Playwright e2e.** Component tests cover the row and the narrow dialog. An e2e would need the flag on and calendar data, which no mobile e2e sets up.
- **No upstream release note**, following the `business-calendars` and `mobile-business-calendars` precedent; fork news follows the fork's release process.

## Risks / Trade-offs

- [The number input is small on a phone] → It keeps the desktop 80px width; it is still easy to tap. A larger mobile input can follow without changing behavior.
- [Undo on mobile] → The handler stays `undoable`, but phones have no undo shortcut. Users change the value again instead, as with other mobile account settings.
