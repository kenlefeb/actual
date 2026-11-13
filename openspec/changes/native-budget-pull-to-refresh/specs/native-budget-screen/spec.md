# Spec Delta

## Purpose

Pull-to-refresh on the native Budget tab (sc-3884), so a change from another device shows up without leaving the app. The base requirements ("The Budget tab re-reads on change events and respects the background", "A real sync reaches the native Budget tab") are in `add-native-budget-screen`; this delta adds to them. The change is iOS-native only: the web app syncs live, and its mobile web screens already pull to refresh.

## ADDED Requirements

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
A pull SHALL NOT run bank sync. A pull while one is in flight SHALL do nothing, and no refresh SHALL start while the app is not active.

#### Scenario: Pulling twice
- **GIVEN** a pull whose sync has not returned
- **WHEN** the user pulls again
- **THEN** no second `sync` call is made

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
The message SHALL depend only on R: `network` "You're offline. Showing the last numbers."; `unauthorized` "Sign in again to sync."; the timeout "Still syncing. The screen updates when it finishes."; every other reason, and a re-read that fails after a good sync, "Couldn't sync. Try again."

#### Scenario: Offline
- **GIVEN** the native Budget tab showing a month and no network
- **WHEN** the user pulls down and `sync` returns `{"ok": false, "reason": "network"}`
- **THEN** the same numbers stay, marked stale, with "You're offline. Showing the last numbers." inline, and the spinner ends

#### Scenario: Signed out
- **GIVEN** the native Budget tab showing a month and an expired session
- **WHEN** the user pulls down and `sync` returns `{"ok": false, "reason": "unauthorized"}`
- **THEN** the numbers stay, with "Sign in again to sync." inline

#### Scenario: Any other failure
- **GIVEN** the native Budget tab showing a month
- **WHEN** `sync` returns `out-of-sync`, `clock-drift`, `encryption` or `other`
- **THEN** the numbers stay, with "Couldn't sync. Try again." inline

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
