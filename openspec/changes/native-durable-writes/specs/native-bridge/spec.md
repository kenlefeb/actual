## ADDED Requirements

### Requirement: A write is saved only when storage says so
In the iPhone and Mac apps, the Swift bridge client SHALL follow every allowlisted write with its own `native/persisted` call, and SHALL return the write's result with `stored: true` or `stored: false` from that call's answer. Swift SHALL treat a write as stored only when that answer, or a later `stored` event, says so. A timed-out `native/persisted` call SHALL never cause the write to be retried. Reads SHALL NOT wait.

#### Scenario: A categorize on the Mac
- **GIVEN** the Mac app with a budget open
- **WHEN** native code categorizes a row
- **THEN** the client returns `stored: true` only after the row's change was committed to IndexedDB

#### Scenario: A kill between the two calls
- **WHEN** the page is killed after the write replies and before `native/persisted` answers
- **THEN** the screen never showed the change as saved

#### Scenario: A read does not wait
- **WHEN** native code reads `native/accounts-list` while a write is still being stored
- **THEN** the read replies without waiting for storage

### Requirement: The storage barrier waits for complete
`native/persisted` SHALL wait, up to `native-persist-wait-ms`, until every pending IndexedDB write of the open budget has fired `complete`, and answer `stored: true`, or `stored: false` when the wait passes. It SHALL be allowlisted in both lists as a call with no arguments, with a `coverage.json` skip. A pending write SHALL settle on `complete`, `abort` or `error`, never hang.

#### Scenario: The chain advances
- **GIVEN** the patched storage on `fake-indexeddb` with three writes queued
- **WHEN** each transaction fires `complete`
- **THEN** `native/persisted` answers `stored: true`, and no write is left pending

#### Scenario: Slow storage
- **GIVEN** a commit that takes 3 s and the default wait of 2000 ms
- **WHEN** the user categorizes a row on iPhone
- **THEN** the row changes, the client returns `stored: false`, "Saved here, not yet stored on this device." shows, and it clears on the `stored` event

### Requirement: Any storage failure latches and is shown app-wide
Any failed IndexedDB write of the open budget, from any source (bridge write, web-screen edit or sync), SHALL set a failed latch. The patched storage SHALL write nothing more, the page SHALL send a `storage-failed` event with `lastStoredFlushAt` (when the last write that stored was flushed), and Swift SHALL show a persistent app-level notice until reload, whichever screen is showing.

#### Scenario: A web-screen edit fails on quota
- **GIVEN** a web-screen edit whose IndexedDB write fails with a quota error
- **WHEN** the person then opens a native screen
- **THEN** the app-level notice shows, and IndexedDB still holds the last good commit

#### Scenario: Failure after a timeout
- **GIVEN** a write whose `native/persisted` call answered `stored: false`
- **WHEN** its transaction later aborts
- **THEN** the `storage-failed` event is sent and the notice shows

### Requirement: No write applies after a storage failure
Before forwarding any write, the page bridge SHALL check the storage's failed latch, whatever set it, and refuse the write with `[native:not-stored]` without applying it. A write whose own storage fails SHALL get `stored: false` and the notice. `native/undo` SHALL be refused the same way.

#### Scenario: A native write after a failure
- **GIVEN** the latch set by a failed web-screen edit
- **WHEN** native code categorizes a row
- **THEN** the call is refused with `[native:not-stored]` and the row is unchanged in memory

#### Scenario: The code is in the list
- **WHEN** the refusal codes fixture is read
- **THEN** it lists `not-stored`

### Requirement: Only stored changes reach the server
The engine SHALL send local changes to the sync server only after `whenPersisted` resolves for the changes it reads to send, waiting at most `native-persist-wait-ms`; on expiry it SHALL send nothing that round and try again at the next scheduled sync. It SHALL send nothing while the failed latch is set, until reload. So a change that was refused or not stored is on neither the device nor the server, and making it again cannot create a duplicate.

#### Scenario: Refused, then made again
- **GIVEN** a transaction added just before a storage failure, refused as not stored
- **WHEN** the person reloads and adds it again
- **THEN** after the next sync the transaction is there once

#### Scenario: Hung storage
- **GIVEN** an IndexedDB write that never settles
- **WHEN** a sync runs
- **THEN** it stops waiting after `native-persist-wait-ms`, sends nothing, and the next scheduled sync tries again

#### Scenario: Stored before the failure
- **GIVEN** changes stored before the failure and not yet synced
- **WHEN** the person reloads
- **THEN** those changes are there and are sent on the next sync

### Requirement: The failure notice says what was lost
The app-level notice SHALL say, from the copy table, that changes can't be saved, to reload, and that changes made after <time> weren't saved and need to be made again, where <time> is `lastStoredFlushAt` in the person's locale. On a quota failure it SHALL say, in four sentences, that the device is full, to free up some space and reload, what was lost, and that saved changes can't sync until there's space. The wording is the Product Owner's, in the copy table.

#### Scenario: The time shown is when the last stored write was flushed
- **GIVEN** a write flushed at 3:42:10 PM that stored at 3:42:12 PM, and a change made at 3:42:11 PM whose write then failed
- **WHEN** the notice shows
- **THEN** it says changes made after 3:42:10 PM need to be made again, so the 3:42:11 change is not reported as saved

#### Scenario: Device full
- **GIVEN** a write that fails with a quota error
- **WHEN** the notice shows
- **THEN** it reads "This device is full, so changes can't be saved. Free up some space, then reload the app. Changes made after <time> weren't saved and need to be made again. Saved changes can't sync until there's space."

### Requirement: The notice's cut-off time is exact
The notice SHALL show `lastStoredFlushAt` to the second in the person's locale (for example 3:42:10 PM), truncated, never rounded up, so a change stored just before it is never re-entered as a duplicate. When no write has stored since the app opened, it SHALL say "Changes made since you opened the app weren't saved and need to be made again." in place of the sentence with <time>.

#### Scenario: Seconds, not minutes
- **GIVEN** a change stored at 3:42:05 PM and `lastStoredFlushAt` 3:42:10.900 PM
- **WHEN** the notice shows
- **THEN** it says "after 3:42:10 PM", never "after 3:42 PM" or "after 3:42:11 PM"

#### Scenario: Nothing stored this session
- **GIVEN** the app opened and its first write failed
- **WHEN** the notice shows
- **THEN** it says "Changes made since you opened the app weren't saved and need to be made again." and shows no time

### Requirement: The storage wait is a limit
`native-persist-wait-ms` SHALL be in the limits registry with the name "Saving: wait for device storage", the help line "How long a change waits to be stored on this device before the app says it isn't yet", default 2000, floor 100 and ceiling 4000, under the 5 s bridge deadline. A value outside floor to ceiling SHALL read as the default.

#### Scenario: Changed in Settings
- **WHEN** the user sets "Saving: wait for device storage" to 3000 in Settings > Advanced > Limits
- **THEN** the next `native/persisted` call waits up to 3 s

#### Scenario: Bad values
- **WHEN** the stored value is "50", "5000" or "abc"
- **THEN** the wait is 2000 ms

### Requirement: The shells flush storage before backgrounding or quitting
The iPhone app SHALL call `native/persisted` when it moves to the background, in a background task with an expiration handler that ends it at once. The task SHALL end at the earliest of the answer, the wait, or expiry. The Mac app SHALL call it before quitting (replying later to terminate) and before closing its window, and best-effort before sleep, which it cannot delay.

#### Scenario: iPhone to the background
- **GIVEN** a change just made in a web screen inside the iPhone app
- **WHEN** the person swipes to the home screen
- **THEN** the app holds a background task until storage finishes, the wait passes or iOS expires it, whichever is first

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

### Requirement: Test hooks are absent from production
Any hook that disables the barrier or delays storage for tests SHALL exist only behind a build-time constant that production builds set false and remove, and Fork CI SHALL fail when the production page or worker bundle contains the hook's marker.

#### Scenario: A production build
- **WHEN** Fork CI builds the production web bundle and searches it for the hook marker
- **THEN** the marker is absent, or the job fails

### Requirement: The barrier is measured and gated
The Mac test suite SHALL time a one-row categorize through the client end to end (the `native/storage-state` check, the write and `native/persisted`) against the bare write, 30 runs each, and SHALL fail when the three together add more than 50 ms to the median or 250 ms to the p95. A real iPhone's median and p95 SHALL be recorded before the native Accounts screen defaults on.

#### Scenario: The gate runs in Mac CI
- **WHEN** the `fork-mac-native` workflow runs the Mac tests
- **THEN** it prints both medians and p95s and fails over the gate

### Requirement: An acknowledged write survives a page-process kill
A write the client returned with `stored: true` SHALL be there after the page's WebContent process is killed with SIGKILL at once and the page reloads, on the Mac app and the iPhone simulator, and the reloaded database SHALL pass `PRAGMA integrity_check`. A control run without the barrier SHALL lose at least one write, or the run is inconclusive and fails.

#### Scenario: Kill after write, 20 times
- **GIVEN** the kill test, run as in `PageProcessKillTests`
- **WHEN** it creates a category, kills the WebContent process the moment the client returns `stored: true`, and reloads, 20 times
- **THEN** all 20 categories are there and the integrity check passes

#### Scenario: The control loses data
- **GIVEN** the barrier off and a test-only commit delay of 300 ms
- **WHEN** the same loop runs
- **THEN** at least one category is lost, and the database still passes the integrity check
