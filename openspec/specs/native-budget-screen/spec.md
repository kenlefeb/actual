# native-budget-screen Specification

## Purpose
How the native Apple Budget tab reads, edits, navigates and refreshes a budget month; the tab only shows numbers loot-core computed (ADR 11).

## Requirements

### Requirement: Pulling down on the Budget tab syncs and re-reads the month
Pulling down on the native Budget tab, in envelope and tracking mode, SHALL call the bridge's `sync`, and when it returns `{"ok": true}` SHALL re-read the visible month once through the existing read path. The system refresh spinner SHALL show until that re-read ends, and SHALL end on success, on failure or on the deadline. The numbers shown SHALL always come from a `native/budget-month` read, never from the sync result.

#### Scenario: Another device changed an amount
- **GIVEN** the native Budget tab showing a month, and a budgeted amount for that month changed on another device and synced to the server
- **WHEN** the user pulls down on the tab
- **THEN** the spinner shows, `sync` runs, the month is re-read once, the new amount shows and the spinner ends, without leaving the app

#### Scenario: A tracking budget
- **GIVEN** the native Budget tab showing a tracking budget
- **WHEN** the user pulls down on the tab
- **THEN** it syncs and re-reads the month the same way, with the tracking layout

#### Scenario: Nothing changed
- **GIVEN** the native Budget tab and no change on the server
- **WHEN** the user pulls down on the tab
- **THEN** the spinner ends, the numbers are unchanged and no error shows

### Requirement: A pull runs one server sync and nothing else
A pull SHALL NOT run bank sync. A pull SHALL do nothing while an earlier pull's `sync` call is still pending, which includes the time after its deadline until the page call settles, so repeated pulls over a suspended engine never queue calls; and no refresh SHALL start while the app is not active.

#### Scenario: Pulling twice
- **GIVEN** a pull whose sync has not returned
- **WHEN** the user pulls again
- **THEN** no second `sync` call is made

#### Scenario: Pulling after the deadline
- **GIVEN** a pull whose 30 second deadline has passed and whose page call has not settled
- **WHEN** the user pulls again
- **THEN** no second `sync` call is made until the first settles

#### Scenario: Not active
- **GIVEN** the app is in the background or the scene is inactive
- **WHEN** a pull would start
- **THEN** no `sync` call and no read is made

#### Scenario: No bank sync
- **GIVEN** the native Budget tab with bank-linked accounts
- **WHEN** the user pulls down on the tab
- **THEN** only the server sync runs, and no bank sync handler is called

### Requirement: A failed or slow refresh keeps the numbers
When `sync` returns `{"ok": false, "reason": R}`, fails with the timeout error, or succeeds and the re-read then fails, the tab SHALL keep the last good numbers on screen, marked stale, and SHALL show a fixed local message inline. No text from the page, the server or loot-core SHALL be shown or logged. VoiceOver SHALL announce the outcome.

#### Scenario: The sync works and the re-read fails
- **GIVEN** the native Budget tab showing a month
- **WHEN** `sync` returns `{"ok": true}` and the re-read then fails
- **THEN** the old numbers stay, marked stale, with "Couldn't sync. Try again." inline

#### Scenario: A failure that carries the server address
- **GIVEN** loot-core's sync error carries the sync server's address in its message
- **WHEN** the tab shows the failure
- **THEN** the screen and every log line contain only the fixed message

#### Scenario: Dynamic Type and Dark Mode
- **GIVEN** the largest accessibility text size, in light and dark appearance
- **WHEN** the inline message shows
- **THEN** it wraps without truncating, uses the semantic colours of `native-appearance`, and VoiceOver reads it

### Requirement: Each refresh failure has a fixed message
The message SHALL depend only on R: `network` "You're offline. Showing the last numbers."; `unauthorized` "Sign in again to sync."; the timeout "Still syncing. The screen updates when it finishes."; every other reason, every other bridge error (the page's own error, the origin error, no page, a bad result) and a re-read that fails after a good sync, "Couldn't sync. Try again." The tab SHALL NOT store, log or show any text that comes with an error.

#### Scenario: Offline
- **GIVEN** the native Budget tab showing a month and no network
- **WHEN** the user pulls down and `sync` returns `{"ok": false, "reason": "network"}`
- **THEN** the same numbers stay, marked stale, with "You're offline. Showing the last numbers." inline, and the spinner ends

#### Scenario: The failed sync's own sync-event
- **GIVEN** a pull whose sync fails, so loot-core sends `sync-event` before `sync` returns `{"ok": false, "reason": R}`
- **WHEN** that event, or any later change event, re-reads the month
- **THEN** the numbers from the read show, still marked stale, with R's fixed message; only a read that no change event caused (a later pull, a month step, the tab showing again or a return to the foreground) clears it

#### Scenario: Signed out
- **GIVEN** the native Budget tab showing a month and an expired session
- **WHEN** the user pulls down and `sync` returns `{"ok": false, "reason": "unauthorized"}`
- **THEN** the numbers stay, with "Sign in again to sync." inline

#### Scenario: Any other failure
- **GIVEN** the native Budget tab showing a month
- **WHEN** `sync` returns `out-of-sync`, `clock-drift`, `encryption` or `other`
- **THEN** the numbers stay, with "Couldn't sync. Try again." inline

#### Scenario: A bridge error that carries the server address
- **GIVEN** the native Budget tab showing a month
- **WHEN** `sync` fails with the page error `https://sync.example.com/sync/sync`, the origin error, no page or a bad result
- **THEN** the numbers stay, with "Couldn't sync. Try again." inline, and the address appears in no log line or on the screen

### Requirement: A timed-out refresh is not retried
After the timeout the tab SHALL NOT retry the sync and SHALL NOT re-read on its own. The `sync-event` that loot-core sends when the sync finishes re-reads the month through the change-event path.

#### Scenario: A sync that outlasts the deadline
- **GIVEN** the native Budget tab showing a month and a sync that does not answer
- **WHEN** 30 seconds pass after the pull
- **THEN** the spinner ends, the numbers stay, "Still syncing. The screen updates when it finishes." shows, and nothing is retried

#### Scenario: The late sync finishes
- **GIVEN** the state after that timeout
- **WHEN** loot-core finishes the sync and sends `sync-event`
- **THEN** the tab re-reads the month through the change-event path and shows the new numbers

### Requirement: The web screens keep one working pull-to-refresh in the iOS app
The mobile web Budget, Accounts and account transactions screens SHALL keep their existing pull-to-refresh, and it SHALL work inside the iOS app's web view. No second gesture and no global "Sync now" control SHALL be added. A web screen with no list gesture (Reports, Schedules, Settings) SHALL keep syncing on focus and after edits only.

#### Scenario: A pull on a web screen on a device
- **GIVEN** the TestFlight build on Ken's iPhone, signed in to staging, with the web Accounts screen showing
- **WHEN** a second client changes a transaction and syncs, and Ken pulls down on the list
- **THEN** the list syncs and shows the change without leaving the app, and the steps and the observed result are recorded on the story

#### Scenario: The gesture does not fire in the web view
- **GIVEN** the device test above
- **WHEN** the pull does nothing
- **THEN** a small fix to the web gesture lands in the same slice, or a bug story is filed, and the requirement stays unmet until it passes

#### Scenario: Desktop and the browser
- **GIVEN** the desktop app or the browser
- **WHEN** this change ships
- **THEN** their behaviour is unchanged

### Requirement: The native Budget tab has a per-screen switch and a web fallback
The iOS app SHALL show the native Budget tab only while a per-screen switch is on. The switch SHALL read on when it has never been set, and an explicit off SHALL be kept, and Settings in the iOS app SHALL offer it. While it is off, the Budget tab SHALL show the web Budget screen exactly as before. A bridge call that fails or times out SHALL show an error state with a retry.

#### Scenario: Switch on
- **GIVEN** an envelope budget open in the iOS app and the switch on
- **WHEN** the user opens the Budget tab
- **THEN** the tab shows the native current month, and its numbers equal the web Budget screen's for the same budget and month

#### Scenario: Switch off
- **GIVEN** the switch is turned off
- **WHEN** the user opens the Budget tab
- **THEN** the web Budget screen is shown

#### Scenario: Default
- **GIVEN** a fresh install of the iOS app, or a device that never set the switch
- **WHEN** the user opens the Budget tab
- **THEN** the native Budget screen is shown, and Settings offers the switch to turn it off

#### Scenario: The read times out
- **GIVEN** the switch is on and the engine does not answer
- **WHEN** the tab loads its month
- **THEN** after the client timeout the tab shows an error state with a retry, instead of an empty or endless spinner

### Requirement: The native Budget tab navigates between months
The native Budget tab SHALL offer previous month, next month and a month picker. Each month SHALL be one `native/budget-month` read. Months outside the budget's range SHALL NOT be reachable. The visible month SHALL survive leaving the tab and returning to it.

#### Scenario: Step back three months
- **GIVEN** the native Budget tab showing the current month
- **WHEN** the user steps to the previous month three times
- **THEN** the tab shows that month's numbers, and they equal the web screen's for the same month

#### Scenario: Month outside the range
- **GIVEN** the native Budget tab showing the budget's first month
- **WHEN** the tab has loaded
- **THEN** previous month is unavailable and the picker offers no earlier month, with no tap needed to learn it

The range comes from `native/budget-month` (`firstMonth` and `lastMonth`, change `native-budget-month-range`, sc-3850); navigation never shows a month outside it.

#### Scenario: Leaving and returning
- **GIVEN** the native Budget tab showing a month other than the current one
- **WHEN** the user opens another tab and comes back
- **THEN** the tab shows the same month

### Requirement: Budgeted amounts are edited through loot-core
On an envelope month the user SHALL be able to tap a category's budgeted amount, type a new one and save. The native side SHALL call the allowlisted `budget/budget-amount` handler and then re-read the month. A save SHALL give a haptic. A failed save SHALL show an error and keep the old value. Native code SHALL NOT open the budget database, write CRDT messages or store a computed total.

#### Scenario: Edit an amount
- **GIVEN** the native Budget tab on an envelope month
- **WHEN** the user saves a new budgeted amount for a category
- **THEN** the tab re-reads the month, its numbers equal the web screen's for the same budget, and the web screen shows the edit

#### Scenario: The save fails
- **GIVEN** the native Budget tab on an envelope month
- **WHEN** a save fails or times out
- **THEN** an error shows and the category keeps its old budgeted amount

#### Scenario: Only valid ids and months are sent
- **GIVEN** the native Budget tab showing a month
- **WHEN** the user edits a category
- **THEN** native code sends only a category id and a month from the last decoded snapshot, and an amount that is an integer in the budget's minor units; an invalid value is never sent

#### Scenario: Writes stay inside loot-core
- **GIVEN** the native Budget tab and the bridge allowlist
- **WHEN** native code writes anything or calls a handler that is not allowlisted
- **THEN** the write goes through an allowlisted loot-core handler or is refused, and the native-Swift check still passes (no database import, no stored totals)

### Requirement: Tracking budgets render and edit like envelope budgets
On a tracking budget the native Budget tab SHALL show the tracking layout (to-budget absent, the tracking totals shown) from the same `native/budget-month` shape, and SHALL edit budgeted amounts through `budget/budget-amount`. The layout SHALL follow the budget type in the month snapshot and not a stored preference. Together with the envelope requirements above, envelope and tracking budgets SHALL both render and edit correctly, matching the web screen's numbers for the same budget.

#### Scenario: Open a tracking budget
- **GIVEN** a tracking budget open in the iOS app with the switch on
- **WHEN** the user opens the Budget tab
- **THEN** the tab shows the tracking layout, with no to-budget, and its numbers equal the web screen's for the same month

#### Scenario: Tracking summary
- **GIVEN** the native Budget tab on a tracking month
- **WHEN** the month loads
- **THEN** a summary shows loot-core's budgeted income, income, budgeted expenses, expenses and saved, and no to-budget row

#### Scenario: Edit on a tracking budget
- **GIVEN** the native Budget tab on a tracking budget
- **WHEN** the user saves a new budgeted amount
- **THEN** the tab re-reads the month, its numbers equal the web screen's, and the web screen shows the edit

#### Scenario: Edit budgeted income on a tracking budget
- **GIVEN** the native Budget tab on a tracking month with an income category
- **WHEN** the user saves a new budgeted amount for that income category
- **THEN** the amount is written through `budget/budget-amount`, and on an envelope month income rows offer no edit

#### Scenario: A budget switched between modes
- **GIVEN** a budget switched from envelope to tracking, or back, on the web
- **WHEN** the native tab next reads the month
- **THEN** it shows the layout of the type in the snapshot

### Requirement: Money is moved between categories and to-budget
On an envelope month the native Budget tab SHALL offer a Move money sheet: pick a source and a destination (a category or to-budget), enter an amount and confirm. The native side SHALL call an allowlisted transfer handler, re-read the month, and give a haptic on success. The sheet SHALL prefill the source's balance, show "You can move up to <amount>", and accept no more; this intentionally differs from the web, which accepts any amount. It SHALL NOT be offered on a tracking month.

#### Scenario: Move from to-budget to a category
- **GIVEN** the native Budget tab on an envelope month with money in to-budget
- **WHEN** the user moves 10 dollars from to-budget to a category and confirms
- **THEN** the category's budgeted amount and to-budget show the move, and equal the web screen's afterwards

#### Scenario: Move between two categories
- **GIVEN** the native Budget tab on an envelope month
- **WHEN** the user moves an amount from one category to another and confirms
- **THEN** both categories show the moved amount and equal the web screen's afterwards

#### Scenario: The sheet shows the limit
- **GIVEN** the Move money sheet opened for a source with a balance of 50.00
- **WHEN** the sheet shows
- **THEN** the amount is prefilled with 50.00, the sheet reads "You can move up to $50.00", and an amount above 50.00 cannot be confirmed

#### Scenario: Tracking month
- **GIVEN** the native Budget tab on a tracking budget
- **WHEN** the user looks for Move money
- **THEN** it is not offered

#### Scenario: Writes stay allowlisted
- **GIVEN** the Move money sheet
- **WHEN** the user confirms a move
- **THEN** the native side uses only allowlisted handlers

### Requirement: The Budget tab re-reads on change events and respects the background
The native Budget tab SHALL subscribe to `cells-changed` and `sync-event` through the bridge and re-read the visible month, at most once per frame; a burst of writes need not collapse to a single read. Every bridge call SHALL use the client timeout (about 5 seconds) and handle the timeout error. The tab SHALL NOT read through the bridge while the app is in the background, and SHALL re-read the visible month when the app returns to the foreground.

#### Scenario: A change from another writer
- **GIVEN** the native Budget tab showing a month
- **WHEN** a budgeted amount for that month changes from the web side or another writer
- **THEN** the tab refreshes through the change event and shows the new number

#### Scenario: A burst of changes
- **GIVEN** the native Budget tab showing a month
- **WHEN** several change events arrive within one frame
- **THEN** the tab re-reads at most once for that frame

#### Scenario: Timeout is handled
- **GIVEN** the engine is suspended and does not answer
- **WHEN** the tab makes a bridge call
- **THEN** the call fails with the timeout error and the tab shows its error state

#### Scenario: Background and foreground
- **GIVEN** the native Budget tab open when the app goes to the background
- **WHEN** a change event arrives in the background, and the app then returns to the foreground
- **THEN** the tab made no bridge read in the background and re-reads the visible month on returning

### Requirement: A real sync reaches the native Budget tab
A change made on another device SHALL reach the native Budget tab through `sync-event`, and the tab SHALL re-read. This SHALL be shown on a device against staging with a repeatable test whose evidence is recorded on the story, because the bridge spike (sc-3584) could not exercise a real sync.

#### Scenario: Another device changes an amount
- **GIVEN** the TestFlight build on Ken's iPhone, signed in to staging, with the native Budget tab showing a month
- **WHEN** a second client changes a budgeted amount in that month and syncs
- **THEN** the iPhone receives `sync-event`, the tab re-reads, and the new amount shows; the steps, the observed refresh and the timings are recorded on the story

#### Scenario: A defect in sync-event forwarding
- **GIVEN** the device test above
- **WHEN** the screen does not refresh
- **THEN** a small fix lands in the same slice, or a bug story is filed, and the requirement stays unmet until it passes

### Requirement: The Budget tab works with Dynamic Type, Dark Mode and VoiceOver
Every control of the native Budget tab, including groups, categories, the edit field and the Move money sheet, SHALL work with Dynamic Type up to the largest accessibility sizes, in light and dark appearance, and with VoiceOver. Amounts SHALL NOT truncate and SHALL use tabular digits. Colours SHALL be the semantic colours of `native-appearance`. VoiceOver SHALL read each control's label, value and trait, in a sensible focus order.

#### Scenario: Largest accessibility size
- **GIVEN** the largest Dynamic Type accessibility size
- **WHEN** the native Budget tab shows a category with a large amount
- **THEN** the amount is complete and not truncated, and no control is cut off

#### Scenario: Dark Mode
- **GIVEN** the native Budget tab open in light appearance
- **WHEN** the device switches to dark appearance
- **THEN** the tab switches without a restart, with legible text and amounts

#### Scenario: VoiceOver on a category
- **GIVEN** VoiceOver on and the focus on a category row
- **WHEN** VoiceOver reads it
- **THEN** it speaks the category name, its budgeted, spent and balance, and that the budgeted amount can be edited

#### Scenario: VoiceOver in the Move money sheet
- **GIVEN** VoiceOver on and the Move money sheet open
- **WHEN** the user moves through it
- **THEN** each field and button has a label, a value and a trait, in reading order

### Requirement: A 300-category month meets the latency target
On a 300-category month, one `native/budget-month` round trip SHALL complete in under 50 ms median (the bridge spike's target), and scrolling the whole month SHALL show no frame that takes longer than 33 ms to render (a dropped frame at 60 Hz). The median and the 95th percentile SHALL be recorded on the story, from the Simulator and then from Ken's iPhone. If the target cannot be met, work SHALL stop and be reported to the Director, so ADR 11 is revisited.

#### Scenario: Render and scroll a big month
- **GIVEN** a 300-category budget open in the iOS app with the switch on
- **WHEN** the native Budget tab loads and the user scrolls through all of it
- **THEN** the month renders within the target and no scrolled frame takes longer than 33 ms, and the median and p95 are recorded on the story

#### Scenario: The target is missed
- **GIVEN** the measurement above
- **WHEN** the median exceeds 50 ms after the lazy-list, diffing and single-read fixes
- **THEN** work stops and the Director is told, so ADR 11 is revisited

### Requirement: The month controls follow the budget's range from the first load
The native Budget tab SHALL take the budget's range from each successful month read. Previous month and next month SHALL be unavailable at the first and last month, and the month picker SHALL offer exactly the months from the first to the last, with no tap needed to learn the edge. The tab SHALL NOT remember a month as missing.

#### Scenario: Opening on the first month
- **GIVEN** the native Budget tab opens on the budget's first month
- **WHEN** the first read finishes
- **THEN** previous month is unavailable and the picker offers no earlier month, and no step was sent to learn it

#### Scenario: Opening on the last month
- **GIVEN** the native Budget tab opens on the budget's last month
- **WHEN** the first read finishes
- **THEN** next month is unavailable and the picker offers no later month

#### Scenario: A month in the middle
- **GIVEN** the native Budget tab on a month between the first and the last
- **WHEN** the user opens the picker
- **THEN** it lists every month from the first to the last, and previous and next are both available

### Requirement: A month the web adds later is offered without a relaunch
After a later read reports a new `lastMonth` or `firstMonth`, the tab SHALL offer that month in next month, previous month and the picker. Any read counts: a change event, a sync, a pull to refresh, a step or returning to the tab. The app SHALL NOT need to be relaunched, and a read that fails SHALL keep the range of the last good read.

#### Scenario: The web budgets ahead
- **GIVEN** the native Budget tab on the last month, with next month unavailable
- **WHEN** the web adds a later month and the tab re-reads
- **THEN** next month and the picker offer the new month, without a relaunch

#### Scenario: A read fails
- **GIVEN** the tab showing a month with a known range
- **WHEN** the next read fails
- **THEN** the numbers stay, marked stale, and previous, next and the picker keep the last known range

### Requirement: A server without the range keeps the screen working
When a read carries no `firstMonth` and `lastMonth`, the tab SHALL still show the month, keep previous and next available, and offer a window of months around the visible one. A step the handler refuses SHALL keep the visible month and its numbers, and SHALL NOT be remembered.

#### Scenario: An older server
- **GIVEN** the page's `native/budget-month` result has no range fields
- **WHEN** the tab loads and the user taps next month past the last month
- **THEN** the tab stays on the same month with its numbers, and a later read that has the range, or a later tap, decides afresh

#### Scenario: Dynamic Type and VoiceOver
- **GIVEN** the largest accessibility text size and VoiceOver on
- **WHEN** previous or next month is unavailable at an edge
- **THEN** its control is announced as dimmed, and the picker lists the months without truncating

### Requirement: The month picker marks the month on screen
The native Budget tab's month picker SHALL mark the row of the month the tab shows, and no other row, so the user can tell where they are in the list. The picker keeps its order (newest first) and does not scroll to the marked row.

#### Scenario: The picker marks the shown month
- **GIVEN** the tab shows a month between the first and the last
- **WHEN** the user opens the picker
- **THEN** that month's row carries a checkmark and no other row does, and after a step or a pick the checkmark is on the new month
- **AND** VoiceOver announces the marked row as selected

### Requirement: The native Budget tab shows the current month
While the per-screen switch is on, the tab SHALL show the current month of an envelope budget, read-only: every group and category with its budgeted, spent and balance, and to-budget.

#### Scenario: Current month
- **GIVEN** an envelope budget open in the iOS app and the switch on
- **WHEN** the user opens the Budget tab
- **THEN** every group and category shows its budgeted, spent and balance, and the to-budget amount is shown
