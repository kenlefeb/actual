# Proposal

## Why

Every user-facing feature ships on desktop and on the phone (Ken, 2026-11-05). Slice 1 of Amazon order itemization (`amazon-order-itemization`, sc-926) is desktop only. This change is step 1 of the phone flow (sc-2556): import the order export on the phone, review it, and apply the Matched charges there.

## What Changes

- The phone's All Accounts menu sheet offers "Import Amazon orders", behind the same experimental flag as desktop. It opens the phone's file picker for the order-history CSV, which is read and parsed on the device, as on desktop.
- A full-screen phone review lists the charges in the desktop groups: Matched, Ambiguous, Not matched, Gift card or points, Already split and Already itemized. Each card shows the order, ship date, amount and items, plus the matched transaction's account, date and payee.
- A Matched card can be applied on its own, or every Matched card at once. Nothing is written until the user applies. Each apply is one undoable step, offered through an Undo notification.
- Every other group is read-only, with a "Resolve on desktop" hint.
- The not-an-order-export refusal and the "Not applied" reasons are the same as on desktop.
- Out of scope: choosing the transaction for an Ambiguous charge on the phone (step 2, sc-2588, built only if Ken uses step 1), and slice 1's exclusions (refunds, gift-card and points allocation, off-budget accounts, automatic refresh).

Mobile scope: `components/modals/AllAccountsMenuModal.tsx` (the All Accounts sheet, opened from the title of `mobile/accounts/AccountPage.tsx` on `/accounts/all`), and a new phone review modal.

## Capabilities

### New Capabilities

- none

### Modified Capabilities

- `amazon-order-itemization`: adds the phone entry point, the phone review and phone apply. Desktop requirements are unchanged, and the phone reuses them for importing, matching, applying and refusing; the delta adds only what differs on the phone.

## Impact

- `desktop-client` only. The loot-core parser, matcher and `amazon-orders-parse` / `amazon-orders-apply` handlers from sc-926 (PR 215) are reused unchanged. No schema, server or sync change.
- The desktop review's state (chosen charges, group titles, skip reasons, the apply call) moves into a shared hook used by both reviews; desktop behavior doesn't change.
- The UI consumes the parser's output (`AmazonChargeReview`), not the export's column names, so sc-926 task 1.1 (the real header) doesn't block this work.
- Depends on `amazon-order-itemization` being archived before this change is archived.
