# Proposal

## Why

Shortcut sc-2989 (epic 470, Baseline fork behavior). Deferred from sc-2913: tags in formatted mobile notes no longer start editing when tapped, but they do nothing, although they look tappable. Desktop already filters the register by the tapped tag; mobile should match.

## What Changes

- Tapping a tag in a transaction's notes in a mobile transaction list (all accounts, a single account, on-budget, off-budget) applies the filter `notes hasTags '#tag'` to that list and never opens the editor.
- A removable "#tag x" chip above the mobile list shows the active tag filter; removing it clears the filter. On mobile a second tag replaces the first (one chip at a time).
- Single-account mobile lists gain `filterConditions` support, as All accounts already has (via navigation state and `make-filters-from-conditions`).
- Desktop: no behavior change. It already adds a `hasTags` condition to the register the user is in, shown as a removable pill, and tags stack: clicking a second tag adds a second pill. This change adds tests that pin it and cites it in the spec. A narrow desktop window takes the mobile branch of `NotesTagFormatter` (`isNarrowWidth`) and so behaves as mobile.
- Known gap, by Product Owner decision (sc-2989, activity-3059): a tag tapped inside the mobile transaction editor still does nothing (and does not start editing). Leaving the editor risks losing unsaved edits.

Out of scope: stacking several tags, tag filtering from the editor, saved filters, server or loot-core changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mobile-note-links`: the requirement "Tap the formatted notes to edit" and its scenario "Tap a tag" change (tags in lists now filter); a new requirement covers the filter, its chip and desktop parity.

## Mobile scope

Mobile screens in `packages/desktop-client/src/components/mobile/`: `accounts/AccountTransactions.tsx` (single account, also used by On/OffBudget), `accounts/AllAccountTransactions.tsx`, `transactions/TransactionListItem.tsx` (new prop), `transactions/TransactionListWithBalances.tsx` (the chip). Shared notes code in `packages/desktop-client/src/notes/`: `NotesTagFormatter.tsx` (forwards `onNotesTagClick` to the mobile branch) and `MobileTaggedNotes.tsx`. The editor (`transactions/NotesField.tsx`, `TransactionEdit.tsx`) is unchanged. Desktop: tests only.
