# Design

## Context

See proposal.md (Why) and `specs/amazon-order-itemization/spec.md`. Only what the approach depends on:

- **Desktop flow (PR 215):** `accounts/AllAccountsMenu.tsx` offers "Import Amazon orders" behind `useFeatureFlag('amazonOrderItemization')`. `accounts/importAmazonOrders.ts` calls `window.Actual.openFileDialog`, sends `amazon-orders-parse`, shows the refusal notification on error, and otherwise pushes the `import-amazon-orders` modal with `{ reviews, onApplied }`. `modals/ImportAmazonOrdersModal.tsx` holds the review state (charge id → chosen transaction id, the skipped list), the group titles and skip reasons, and calls `amazon-orders-apply`.
- **Handlers:** `amazon-orders-apply` is `mutator(undoable(...))`, so one call is one undo step. It returns `{ applied, skipped }`. The parser returns `AmazonChargeReview[]` (`loot-core/src/server/amazon-orders/types.ts`); the UI never sees column names. The statuses include `already-split`, which the desktop review shows as its own group.
- **Phone accounts:** the Accounts tab has no menu. Its "All accounts" row opens `/accounts/all` (`mobile/accounts/AccountPage.tsx`), whose title opens the `all-accounts-menu` sheet (`modals/AllAccountsMenuModal.tsx`, `MobileSheet` + `MobileSheetRow`). That sheet is the phone counterpart of desktop's `AllAccountsMenu`.
- **File picker:** on the web build, `openFileDialog` (`browser-preload.js`) uses a hidden `<input type="file">` with `accept` from the filter's extensions; that opens the iOS/Android picker. Parsing already deletes its `/uploads` copy.
- **Undo on the phone:** there is no keyboard shortcut. `useUndo().showUndoNotification` shows a notification with an Undo button on narrow widths; its `button` can be overridden.

## Goals / Non-Goals

**Goals:**
- One source of review state and wording for both reviews, so desktop and phone can't drift.

**Non-Goals:**
- Choosing an Ambiguous charge's transaction on the phone (sc-2588).
- A new route or page for the review.
- Any loot-core change.

## Decisions

### 1. Entry point: a row in the All Accounts sheet
- `AllAccountsMenuModal` adds a "Import Amazon orders" row when the flag is on. It closes the sheet and calls the existing `importAmazonOrders(dispatch, () => {})`. The phone's transaction lists are live queries, so `onApplied` has nothing to refresh.
- *Alternative:* a new menu button on the Accounts tab header. Rejected: that header has only "Add account" and no menu, and the desktop entry point is the all-accounts menu too.

### 2. The review is a modal, swapped by width
- `Modals.tsx` renders the new `MobileImportAmazonOrdersModal` for `import-amazon-orders` when `isNarrowWidth`, and the desktop modal otherwise. `importAmazonOrders` and the modal's options don't change.
- The phone modal fills the viewport (no sheet presentation): `ModalHeader` with title and close, a scrolling list, and a sticky footer with "Apply all (N)".
- *Why a modal, not a route:* the parsed export must not outlive the review (spec "Import an order export on the device"). Modal options live in memory and are dropped on close or reload; a route would need history state or a store, and a back-navigation story.
- *Alternative:* a separate modal name pushed by a phone-specific import function. Rejected: duplicates `importAmazonOrders` for no behavior difference.

### 3. Extract the shared review state into a hook
- New `components/accounts/useAmazonOrderReview.ts` takes `{ reviews, onApplied }` and returns: `GROUPS` order, `groupTitles`, `skipReasons`, `chosen` / `toggle` / `usedIds`, `isApplying`, and `apply(chargeIds)` which sends `amazon-orders-apply` for those charges and returns its result.
- `ImportAmazonOrdersModal` is refactored onto it with no behavior change; its existing tests are the guard.
- The phone screen uses the same hook plus a local `applied` set (charge ids) and a per-charge `skippedReason`.
- *Alternative:* copy the strings and apply call into the phone modal. Rejected: two copies of the skip reasons and group titles drift, and i18n gets two keys for one message.

### 4. Phone apply and undo
- "Apply" on a card calls `apply([chargeId])`; "Apply all" calls `apply(all Matched not yet applied)`. Each is one handler call, so one undo step.
- Applied charges join `applied`; their card shows "Applied" and loses its button. Skipped charges show the shared skip reason on the card.
- After an apply that itemized anything, call `showUndoNotification` with a message like "Itemized 3 Amazon charges" and a `button` whose action dispatches the app's `undo` and removes those charge ids from `applied`, so they can be applied again.
- The review stays open after "Apply all", so the Undo is next to the result.
- Rows the phone can't choose (Ambiguous) never enter `chosen`; only Matched rows are sent.

### 5. Small-screen card layout
- One card per charge, full width: line 1 order id (left) and amount as `FinancialText` (right); line 2 ship date; line 3, when there is a transaction, `account · date · payee` and "Reconciled"; line 4 items, `name ×qty` joined, clamped to two lines.
- Matched cards end with an "Apply" button (or "Applied").
- Group header: title and count. Read-only groups have a one-line hint under the title, in subdued text:
  - Ambiguous: "Resolve on desktop: choose its transaction there."
  - Not matched, gift card or points, Already split, Already itemized: "Resolve on desktop."
- Empty groups aren't shown, as on desktop.
- Touch targets follow existing mobile buttons; amounts use `FinancialText`.

## Risks / Trade-offs

- **[Risk] iOS Safari greys out the CSV in the picker.** → `openFileDialog` already maps extensions to `accept`; the Tester checks on a device (task 4.2). If it fails, add a `csv` entry (`text/csv`, `public.comma-separated-values-text`) to `FILE_ACCEPT_OVERRIDES`, as was done for `qfx`.
- **[Risk] A large export makes a long list on a phone.** → Matched comes first and has "Apply all"; read-only groups are below. No virtualization in step 1.
- **[Trade-off] Undo after the notification times out** is only the app-wide undo, which the phone has no button for. Same as other phone actions that use the Undo notification.
- **[Risk] The width swap shows the phone review in a narrow desktop window.** → It's the same data and handlers; acceptable, and how other modals adapt.

## Migration Plan

- No migration. Ships behind the existing flag. Rollback: revert the PR; desktop is unchanged by the hook extraction.
