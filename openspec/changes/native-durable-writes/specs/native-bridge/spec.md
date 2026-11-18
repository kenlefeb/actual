## ADDED Requirements

### Requirement: Native writes reply once stored
In the iPhone and Mac apps, the page bridge SHALL, after every allowlisted write and before replying to Swift, call `native/persisted`, which waits for every pending IndexedDB write of the open budget, up to `native-persist-wait-ms`. Only then SHALL the write reply. `native/persisted` SHALL be allowlisted in both lists as a call with no arguments, and reads SHALL NOT wait.

#### Scenario: A categorize on the Mac
- **GIVEN** the Mac app with a budget open
- **WHEN** native code categorizes a row and the call replies
- **THEN** the row's change was already committed to IndexedDB when the reply was sent

#### Scenario: A read does not wait
- **WHEN** native code reads `native/accounts-list` while a write is still being stored
- **THEN** the read replies without waiting for storage

### Requirement: A write past the storage wait says it is not yet stored
When storage does not finish within `native-persist-wait-ms`, the write SHALL still reply with its result, and the page SHALL send Swift a `not-stored-yet` event. Swift SHALL then show "Saved here, not yet stored on this device." until the page sends `stored`, when every pending write finishes. The copy SHALL come from the copy table.

#### Scenario: Slow storage
- **GIVEN** IndexedDB that takes 3 s to commit and the default wait of 2000 ms
- **WHEN** the user categorizes a row on iPhone
- **THEN** the row changes, the notice shows after about 2 s, and it clears when the commit finishes

#### Scenario: No duplicate on retry
- **WHEN** the user sees the notice
- **THEN** the write is not refused, so it is never retried and applied twice

### Requirement: A failed store is refused and stops further writes
When a pending IndexedDB write fails (the fallback safety check, quota, or any transaction error), the patched storage SHALL stop writing the file, and the next write or `native/persisted` call SHALL be refused with `[native:not-stored]`, and so SHALL every later write, before it applies, until the page reloads. Swift SHALL say "Changes can't be stored on this device right now. Reload the app; recent changes may need to be made again."

#### Scenario: Storage full
- **GIVEN** an IndexedDB write that fails with a quota error
- **WHEN** native code makes the write and then another
- **THEN** the first reply is refused with `[native:not-stored]`, the second is refused before it applies, and IndexedDB still holds the last good commit

#### Scenario: The code is in the list
- **WHEN** the refusal codes fixture is read
- **THEN** it lists `not-stored`, and Swift maps it to the copy above

### Requirement: The storage wait is a limit
`native-persist-wait-ms` SHALL be in the limits registry with the name "Saving: wait for device storage", the help line "How long a change waits to be stored on this device before the app says it isn't yet", default 2000 and ceiling 30000, read on every barrier call. A missing or bad value SHALL use the default.

#### Scenario: Changed in Settings
- **WHEN** the user sets "Saving: wait for device storage" to 5000 in Settings > Advanced > Limits
- **THEN** the next write waits up to 5 s before the not-yet-stored notice

#### Scenario: A bad value
- **WHEN** the stored value is "0", "40000" or "abc"
- **THEN** the wait is 2000 ms

### Requirement: The shells flush storage before backgrounding or quitting
The iPhone app SHALL call `native/persisted` when it moves to the background, inside a background task that ends when the call answers or the wait passes. The Mac app SHALL call it before it quits (replying later to the terminate request), before its window closes and before the Mac sleeps. Each SHALL proceed after the wait even if storage has not finished.

#### Scenario: iPhone to the background
- **GIVEN** a change just made in a web screen inside the iPhone app
- **WHEN** the person swipes to the home screen
- **THEN** the app holds a background task until storage finishes or the wait passes

#### Scenario: Mac quit
- **GIVEN** a change still being stored
- **WHEN** the person quits the Mac app
- **THEN** the app quits after storage finishes, or after the wait at the latest

### Requirement: Only the native shells wait for storage
The barrier SHALL resolve at once wherever writes are already durable when they return: absurd-sql's SharedArrayBuffer mode (the web app from our server), Electron and the API (better-sqlite3), so the browser app, Electron and MCP behave and perform as before.

#### Scenario: MCP
- **WHEN** an MCP write tool runs on the API
- **THEN** no barrier is called and its timing is unchanged

#### Scenario: The web app from our server
- **WHEN** a cross-origin-isolated page calls `native/persisted`
- **THEN** it answers stored at once

### Requirement: The barrier is measured and gated
The Mac test suite SHALL time a one-row categorize through the bridge with and without the barrier, 30 runs, and SHALL fail when the barrier adds more than 50 ms to the median or 250 ms to the p95. The iPhone cost SHALL be measured on a real device and the simulator and recorded in the PR.

#### Scenario: The gate runs in Mac CI
- **WHEN** the `fork-mac-native` workflow runs the Mac tests
- **THEN** it prints both medians and p95s and fails over the gate

### Requirement: An acknowledged write survives a page-process kill
A native write that replied without the not-yet-stored event SHALL still be there after the page's WebContent process is killed with SIGKILL immediately after the reply and the page reloads, on the Mac app and the iPhone simulator.

#### Scenario: Kill after write, 20 times
- **GIVEN** the kill test, run as in `PageProcessKillTests`
- **WHEN** it creates a category through the bridge, kills the WebContent process the moment the reply arrives, and reloads, 20 times
- **THEN** all 20 categories are there
