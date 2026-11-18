## Purpose

The SwiftUI Accounts tab of the iPhone app: the accounts list, closed accounts and the account register. They show and change only what loot-core computes and writes. The Mac screens wait for the Mac app (sc-3629).

## ADDED Requirements

### Requirement: The native Accounts screen ships on with a web fallback
A per-device switch `NativeScreen.accounts` SHALL choose the native Accounts screens, reading on when unset. Web Settings › Native screens SHALL turn it off, and with it off the Accounts tab SHALL show the web screens unchanged. Flipping it SHALL need no data migration.

#### Scenario: First launch after the update
- **GIVEN** the switch has never been set
- **WHEN** the user opens the Accounts tab
- **THEN** the native Accounts list shows

#### Scenario: Turned off
- **GIVEN** the user turns the switch off in Settings
- **WHEN** they open the Accounts tab
- **THEN** the web Accounts screen shows, as before this change

### Requirement: Account routes open the native screens
While the switch is on, the page showing `/accounts` SHALL show the native list, and `/accounts/<id>` for a known account SHALL show the native register with the Accounts tab selected. Other paths SHALL stay web: the all-accounts register until sc-4387, and the transaction editor until sc-3602, from which back returns to the native register where it was.

#### Scenario: A budget drill-down
- **WHEN** a web screen routes to `/accounts/<id>`
- **THEN** the native register for that account shows

#### Scenario: Opening a transaction
- **WHEN** the user taps a row and then goes back
- **THEN** the web editor shows, and back returns to the register at the same scroll position

### Requirement: The accounts list shows loot-core's numbers by section
The list SHALL show "All accounts", On budget and Off budget with totals, a "Closed accounts" row with its count, and a Net worth footer. A row SHALL show name, detail line and signed balance, negatives in the negative colour, all from `native/accounts-list`. The subtitle SHALL carry sync status in words. Pull-down SHALL sync and re-read.

#### Scenario: Matching the web
- **GIVEN** a budget open on the web and on iPhone
- **WHEN** the native list shows
- **THEN** every balance and total equals the web's, and the footer shows net worth

#### Scenario: A paycheck clearing account
- **WHEN** an account is a paycheck clearing account
- **THEN** its detail line names the paycheck and says it goes back to 0 each payday

#### Scenario: Sync failed
- **WHEN** a budget sync fails
- **THEN** the subtitle reads "Sync failed — tap to retry" in warning text until a sync completes

### Requirement: Web account actions stay reachable
Until their native stories ship, the + menu and the no-accounts state SHALL offer Add account and Link bank account (sc-4949), and the register's ••• menu SHALL offer Account settings and Sync now (sc-4385), each opening the existing web flow over the tab, returning to the native screen, which re-reads, when it closes.

#### Scenario: Add an account
- **WHEN** the user taps + › Add account
- **THEN** the web add-account dialog opens, and after saving the new account shows in the native list

#### Scenario: No accounts
- **GIVEN** a budget with no accounts
- **THEN** "Add your first account" shows with Add account and Link bank account, each opening the web flow

#### Scenario: Account settings
- **WHEN** the user picks ••• › Account settings in a register
- **THEN** the web account settings for that account open, and closing them returns to the register

### Requirement: Closed accounts can be reopened
Closed accounts SHALL list by name in secondary text. A trailing swipe and the context menu SHALL offer Reopen in teal, undoable through native Undo; the account then returns to its section. Tapping a closed account SHALL open its register read-only.

#### Scenario: Reopen
- **WHEN** the user swipes a closed account and taps Reopen
- **THEN** it appears in its On or Off budget section, and Undo closes it again

### Requirement: Accounts can be reordered
In Edit mode the list SHALL show drag handles, and dropping an account SHALL move it within its section through `native/account-move`. An account SHALL NOT move between sections.

#### Scenario: Reorder
- **WHEN** the user drags Savings above Checking in Edit mode
- **THEN** the order changes on the web too, and Undo restores it

### Requirement: The register pages on demand
The register SHALL show the header (working, cleared, uncleared), then upcoming schedules in grey marked "Scheduled", then date sections newest first, loading the next page as the user nears the end. Rows SHALL use `NativeTransactionRow` with payee, category or "Split (n)", signed amount with incoming in green and +, and a status word.

#### Scenario: A long register
- **GIVEN** an account with 20,000 transactions
- **WHEN** the user scrolls to the bottom
- **THEN** pages load as needed, one call each, and scrolling does not stall

#### Scenario: Uncategorized row
- **THEN** its category reads "Uncategorized" in warning text

### Requirement: Search and scope chips filter the register
The system search field SHALL search payee, category, notes and amount; Cancel SHALL restore the register. Chips All, Uncleared and Uncategorized SHALL set the scope. While searching the header SHALL hide; while any filter is active (a search or a scope other than All) the list SHALL show "N results" and a footer the results' total, and no results SHALL read "No transactions match “<text>”."

#### Scenario: Search
- **WHEN** the user types "costco"
- **THEN** the results equal the web register's search, and the footer totals them

#### Scenario: No results
- **WHEN** nothing matches
- **THEN** the centred secondary text says no transactions match

### Requirement: Register rows can be cleared, categorized and deleted
A leading swipe SHALL toggle cleared with a haptic; a long-press SHALL offer Categorize through a picker of the budget's categories; a trailing swipe SHALL offer Delete. A reconciled row, or a transfer whose partner is reconciled, SHALL ask first, then send `confirmedReconciled`. Deleting a transfer SHALL name the partner account. Changes SHALL go through loot-core and be undoable.

#### Scenario: Categorize
- **WHEN** the user picks Groceries for an uncategorized row
- **THEN** the row and the web show Groceries, and Undo restores it

#### Scenario: Delete a transfer
- **WHEN** the user swipes to delete a transfer to Savings
- **THEN** the confirmation says the Savings row is deleted too

#### Scenario: Undo after a synced edit
- **WHEN** the user taps Undo after another device changed the same rows
- **THEN** "Changed since — can't undo" shows and nothing changes

#### Scenario: Delete a reconciled row
- **WHEN** the user swipes to delete a reconciled row
- **THEN** a confirmation says it is reconciled, and nothing is deleted unless they confirm

### Requirement: Reconcile enters from the native Accounts screens
The list SHALL show a banner from `native/reconcile-month` while accounts are due, collapsing once the month is done, opening the Reconcile checklist. The register's ••• menu and a list row's long-press SHALL open Reconcile for that account. The web reconcile banner SHALL show only while the switch is off.

#### Scenario: From the register
- **WHEN** the user picks ••• › Reconcile on Joint Checking
- **THEN** the native Reconcile flow opens on Joint Checking

#### Scenario: Web banner
- **GIVEN** the native Accounts switch is on
- **THEN** the web Accounts page shows no reconcile banner

### Requirement: The screens keep their numbers through slow or failed reads
The first load SHALL show redacted placeholders on the real layout, with no spinner. Later re-reads, errors and timeouts SHALL keep the last numbers. Change events SHALL coalesce into one re-read of the visible view. No read SHALL start in the background, and the visible view SHALL re-read on return.

#### Scenario: A write on another device
- **WHEN** a sync brings several changed transactions
- **THEN** the visible register re-reads once and updates without a manual refresh

#### Scenario: A timeout
- **WHEN** a re-read times out
- **THEN** the previous rows stay and the subtitle says what failed

### Requirement: The screens are accessible
Text SHALL scale with Dynamic Type to AX5, wrapping names and moving amounts under them, never truncating an amount. VoiceOver SHALL read each row whole, offer swipes as custom actions, and announce status in words, never colour alone. Dark Mode SHALL use the design system colours; all text SHALL be localized.

#### Scenario: Largest text size
- **WHEN** Dynamic Type is AX5
- **THEN** every balance and amount shows in full

#### Scenario: VoiceOver on a row
- **THEN** it reads payee, category, amount and status, and offers Clear, Categorize and Delete as actions
