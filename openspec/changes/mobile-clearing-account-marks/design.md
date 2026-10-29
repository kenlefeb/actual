# Design

## Context

See proposal.md and specs/paychecks/spec.md.

- `components/schedules/ClearingAccount.tsx` holds the desktop pieces:
  - `ClearingAccountIcon({ accountId })` renders the money-bag icon with a visually hidden label (`Clearing account for paycheck "{{name}}"`). It renders nothing unless the `paychecks` flag is on and `usePaycheckMembership().byClearingAccount` has the account.
  - `ClearingAccountNote({ accountId })` renders the one-line note ("Clearing account for paycheck "Acme". It should return to zero after each payday."). When `useClearingStatus(paycheck.id)` reports `isWarning`, it appends `ClearingWarning` in the same line, so the note is followed by the warning rather than replaced by it.
  - `useClearingStatus` reads `paycheckQueries.clearingStatus()`. The server decides `isWarning`, so the timing is shared by every caller, and `sync-events.ts` already invalidates the query when paychecks, transactions, schedules, rules or accounts change.
- On desktop the icon is placed in both sidebars (`sidebar/Account.tsx`, `sidebar/redesign/AccountRow.tsx`) and the note in `accounts/Account.tsx:1934`, between the header and the transaction list. `PaycheckRow` reuses `ClearingWarning` on the Schedules page, on desktop and mobile.
- On narrow layouts:
  - `components/mobile/accounts/AccountsPage.tsx` lists accounts with `AccountListItem`, whose name is a `TextOneLine` in a row after the sync-status dot.
  - `/accounts/:id` renders `mobile/accounts/AccountPage.tsx`. For a single account this renders `AccountTransactions.tsx`, which shows `ReconcilingBanner` while reconciling and then `TransactionListWithBalances` (balances, search and the list).
  - None of these use the clearing components.

## Goals / Non-Goals

**Goals:**
- Phone users see the same mark, note and warning as desktop users, from the same components, so the text and timing can't drift.

**Non-Goals:**
- Changing the desktop layout, the warning's timing or the clearing status query.
- The phone form save layout the UX Designer raised. This change adds no form or save action, so it's a follow-up (see Product decisions).

## Decisions

### Reuse the desktop components unchanged
The mobile list and page render `ClearingAccountIcon` and `ClearingAccountNote` with the account id. They already handle the flag, the membership lookup and the warning, so "neither for an ordinary account or with the flag off" needs no new code.
- Alternative: mobile-specific components. Rejected because the text and the warning logic would be duplicated.

### Icon after the name in the accounts list row
Put `ClearingAccountIcon` right after the name's `TextOneLine`, inside the same row, as the sidebar puts it after the name. The hidden label becomes part of the row's accessible name, which is what tests query.

### Note at the top of the account's transactions, in `AccountTransactions.tsx`
Render `ClearingAccountNote` above `TransactionListWithBalances`, after `ReconcilingBanner` when reconciling. It shows while searching and reconciling too, as the desktop note does.
- Why this file and not `AccountPage.tsx`: the note belongs with the single account's transactions, and PR #68 (sc-492) is editing `AccountPage.tsx`.
- Alternative: in the page header, next to the account name. Rejected because the header has no room for a sentence on a phone.

### Mobile padding
`ClearingAccountNote` uses `styles.pageContent` padding, which is sized for desktop. If it doesn't line up with the mobile balance row, give the component an optional `style` override, used only by the mobile caller. The desktop rendering stays as it is.

## Product decisions

For the Product Owner to confirm in review (recommendations given):

1. **Spec wording "becomes a warning":** both platforms show the note followed by the warning. The requirement says the note "SHALL become a warning". This change keeps that sentence and copies the desktop behavior. Recommendation: keep the behavior, and let the Solution Architect reword the requirement to "is followed by a warning" in a separate change.
2. **Icon on the mobile account page title:** recommendation: no. The note on the page already says it, and the title row is crowded.
3. **Tests:** component tests only, no Playwright e2e, as for sc-492. The visual fit is checked by the manual step 3.2.
4. **Release notes:** no upstream release note, since paychecks are fork-only. The fork release that ships this gets its release note and fork-news entry.
5. **Phone form save layout:** out of scope here. Recommendation: its own story under epic #28 for the UX Designer's proposal, since it covers the paycheck editor and other phone forms, not this display-only change.

## Risks / Trade-offs

- [The list row has little width on a phone, and the icon takes about 16px from long names] → The name already truncates with `TextOneLine`, and the icon doesn't shrink.
- [The note pushes the transaction list down by about one line] → This matches desktop, and it only happens for clearing accounts.
- [No automated layout check] → jsdom does no layout, so the fit is checked by the manual narrow-viewport step.
