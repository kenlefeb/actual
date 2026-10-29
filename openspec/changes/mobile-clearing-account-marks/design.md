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

### Icon after the name in the accounts list row, sized for the row
Put `ClearingAccountIcon` right after the name, as the sidebar does. The hidden label becomes part of the row's accessible name, which is what tests query.
- **Size:** the icon is fixed at 11×11 for the 13px sidebar, which looks like a speck next to the 17px/600 mobile name. `ClearingAccountIcon` gets an optional `size` prop that defaults to 11, so the desktop is unchanged. The mobile row passes about 14. The icon is `currentColor`, so it follows the name's colour.
- **Truncation:** today `TextOneLine` grows to fill the row, which would push the icon against the balance. Wrap the name and the icon in a row where the name can shrink (`minWidth: 0`) and the icon can't (`flexShrink: 0`). "Acme Paycheck Clearing" then truncates to "Acme Paycheck Cl…", with the bag right after it and the balance unmoved.

### Note at the top of the account's transactions, in `AccountTransactions.tsx`
Render `ClearingAccountNote` above `TransactionListWithBalances`, after `ReconcilingBanner` when reconciling. It shows while searching and reconciling too, as the desktop note does.
- Why this file and not `AccountPage.tsx`: the note belongs with the single account's transactions, and PR #68 (sc-492) is editing `AccountPage.tsx`.
- Alternative: in the page header, next to the account name. Rejected because the header has no room for a sentence on a phone.

### Mobile padding and layout of the note
- **Padding:** `styles.pageContent` gives only 2px of side padding below 512px wide (`component-library/src/styles.ts`), so the note would sit 2px from the edge of a phone screen. `ClearingAccountNote` gets an optional `style` override. The mobile caller passes 10px side and vertical padding, matching the search bar and the reconcile banner. Desktop rendering is unchanged.
- **Warning on its own line:** on desktop the warning is appended to the note's sentence. At 375px that would wrap into about four lines that change colour mid-paragraph, with the actionable part starting mid-line. So on phones the warning is its own line below the note, with the same components, text and timing. `ClearingAccountNote` gets an optional flag (for example `isWarningOnOwnLine`) that the mobile caller sets. The desktop default keeps the sentence as it is today.

Layout decisions in this section and the previous one (icon size and truncation, the note's padding, the warning on its own line) are the UX Designer's, from the PR #72 review.

## Product decisions

For the Product Owner to confirm in review (recommendations given):

1. **Spec wording "becomes a warning":** both platforms show the note followed by the warning. The requirement says the note "SHALL become a warning". This change keeps that sentence and copies the desktop behavior. Recommendation: keep the behavior, and let the Solution Architect reword the requirement to "is followed by a warning" in a separate change.
2. **Icon on the mobile account page title:** recommendation: no. The note on the page already says it, and the title row is crowded.
3. **Tests:** component tests only, no Playwright e2e, as for sc-492. The visual fit is checked by the manual step 3.2.
4. **Release notes:** no upstream release note, since paychecks are fork-only. The fork release that ships this gets its release note and fork-news entry.
5. **Phone form save layout:** out of scope here. Recommendation: its own story under epic #28, since it covers the paycheck editor and other phone forms, not this display-only change. The UX Designer has proposed the pattern on PR #72: a sticky full-width 40px Save on full-page phone editors, and compact right-aligned 40px Cancel and Save on short sheets.

## Risks / Trade-offs

- [The list row has little width on a phone, and the icon takes about 14px from long names] → The name shrinks and truncates with an ellipsis, and the icon doesn't shrink (see the icon decision).
- [The note pushes the transaction list down by one line, or two with the warning] → It only happens for clearing accounts, and the explanation reads before the balance.
- [No automated layout check] → jsdom does no layout, so the fit is checked by the manual narrow-viewport step.
