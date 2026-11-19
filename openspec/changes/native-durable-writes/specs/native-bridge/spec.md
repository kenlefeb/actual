## MODIFIED Requirements

### Requirement: Sync failure reasons map to a closed set
The page SHALL map loot-core's reason as follows: `network-failure` to `network`; `unauthorized`, `out-of-sync`, `clock-drift`, `storage-slow` and `storage-failed` to themselves; `encrypt-failure` and `decrypt-failure` to `encryption`; every other reason, including an unknown one, to `other`. Swift SHALL decode R into a closed set and treat any other value as `other`.

#### Scenario: Each failure
- **GIVEN** loot-core's sync fails with reason `network-failure`, `unauthorized`, `out-of-sync`, `clock-drift`, `encrypt-failure`, `decrypt-failure` or `invalid-schema`
- **WHEN** native code calls `sync`
- **THEN** the result is `{"ok": false, "reason": R}` with `network`, `unauthorized`, `out-of-sync`, `clock-drift`, `encryption`, `encryption` or `other`, in that order

#### Scenario: An unknown reason
- **GIVEN** loot-core's sync fails with a reason not listed above, or the page returns a reason Swift does not know
- **WHEN** native code receives the result
- **THEN** the reason is `other`

#### Scenario: Storage reasons
- **GIVEN** loot-core's sync fails with reason `storage-slow` or `storage-failed`
- **WHEN** native code calls `sync`
- **THEN** the result is `{"ok": false, "reason": R}` with that same reason

## ADDED Requirements

### Requirement: A write is saved only when storage says so
In an opted-in shell, the Swift bridge client SHALL follow every allowlisted write with its own `native/persisted` call, and SHALL return the write's result with `stored: true` or `stored: false` from that call's answer. Swift SHALL treat a write as stored only when that answer, or a later `stored` event, says so. A timed-out `native/persisted` call SHALL never cause the write to be retried. Reads SHALL NOT wait.

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

### Requirement: Screens say "Saved" only once the write is stored
In an opted-in shell, a success message saying "Saved" SHALL appear only after the write is stored. Until then the screen SHALL show no success message, and the storage status line carries the interim state. Undo SHALL be offered at once, labelled "Undo", with no claim of saving. If the write is never stored, the failure or restart notice speaks and no "Saved" SHALL ever show.

#### Scenario: Paychecks
- **GIVEN** a paycheck saved while storage is slow
- **WHEN** the write replies with `stored: false`
- **THEN** Undo shows at once, labelled "Undo", and `Saved "Pay".` or `Saved Pay. Undo is available.` shows only when `stored` arrives

#### Scenario: Never stored
- **GIVEN** a write that replied `stored: false`
- **WHEN** storage fails, or the page restarts
- **THEN** the failure or restart notice shows, and no "Saved" message ever shows for that write

### Requirement: Budget and Reconcile wait for storage before "Saved"
Until a Budget write is stored, a refresh failure SHALL read "The budget could not be refreshed."; "Saved, but the budget could not be refreshed." SHALL be used only once stored. Reconcile's "Saved from your cleared balance" alert SHALL show only if the write is stored before step 2 opens; stored later, no alert shows and nothing is announced. Budget's "Saved" summary label on a tracking budget and the "could not be saved" errors are not affected.

#### Scenario: Budget refresh fails before storage
- **GIVEN** a budget amount written while storage is slow
- **WHEN** the refresh after it fails
- **THEN** the message reads "The budget could not be refreshed."

#### Scenario: Reconcile, stored at once
- **GIVEN** a statement balance saved from the cleared balance
- **WHEN** the write is stored before step 2 opens
- **THEN** "Saved from your cleared balance" shows

#### Scenario: Reconcile, stored later
- **GIVEN** a statement balance saved from the cleared balance while storage is slow
- **WHEN** step 2 opens and the write is stored afterwards
- **THEN** no alert shows and nothing is announced; the balance still shows its source

### Requirement: The storage barrier waits for complete
`native/persisted` SHALL wait, up to `native-persist-wait-ms`, until every pending IndexedDB write of the open budget (of every file with `allFiles: true`, its only argument) has fired `complete`, answering `stored: true`, or `stored: false` on timeout. It SHALL be allowlisted in both lists with a `coverage.json` skip. A pending write SHALL settle on `complete`, `abort` or `error`. When a timed-out wait's writes finish, the engine SHALL send `storage-stored`, forwarded to Swift as `stored`.

#### Scenario: The chain advances
- **GIVEN** the patched storage on `fake-indexeddb` with three writes queued
- **WHEN** each transaction fires `complete`
- **THEN** `native/persisted` answers `stored: true`, and no write is left pending

#### Scenario: Slow storage
- **GIVEN** a commit that takes 3 s and the default wait of 2000 ms
- **WHEN** the user categorizes a row on iPhone
- **THEN** the row changes, the client returns `stored: false`, "Still saving to this device. Keep the app open." shows, and it clears when the engine's `storage-stored` reaches Swift as `stored`

### Requirement: A not-yet-stored write belongs to its page load
Swift SHALL track each unconfirmed write by its own page-load generation and, once answered, by `seq`, which holds the page load's epoch and the write's order in it. A `stored: true` answer or `stored` event SHALL clear only writes of its own epoch. A restart SHALL turn every pending write of an older epoch into "may not have been saved", covered by the restart notice, and no later success SHALL clear it.

#### Scenario: A success after a restart
- **GIVEN** a write showing "Still saving to this device. Keep the app open." when the page restarts
- **WHEN** a write in the new page answers `stored: true`, or a `stored` event arrives with the same number in the new epoch
- **THEN** the earlier write is not reported as stored, it stays "may not have been saved", the status line clears, and the restart notice says so

#### Scenario: No answer before the restart
- **GIVEN** a write whose `native/persisted` call never answered, so it has no `seq`, when the page restarts
- **WHEN** a write in the new page answers `stored: true`
- **THEN** the earlier write's generation is older, so it is not reported as stored and stays "may not have been saved"

### Requirement: The storage status line shows only saving states
The native storage status line SHALL show only "Saving…" while a write awaits its answer and "Still saving to this device. Keep the app open." after `stored: false`, until stored. Once shown, "Saving…" SHALL stay at least 0.6 s, with no animation and without delaying any reply. A restart that leaves a write "may not have been saved" SHALL clear the line.

#### Scenario: A quick write after "Saving…" appears
- **GIVEN** "Saving…" showing
- **WHEN** the write is stored 0.1 s later
- **THEN** the write's result is returned at once, and "Saving…" stays until 0.6 s after it appeared

#### Scenario: Storage is slow
- **GIVEN** "Saving…" showing
- **WHEN** the client returns `stored: false`
- **THEN** the line changes to "Still saving to this device. Keep the app open."

### Requirement: The storage status line never covers what a person needs
On iPhone, while the storage status line shows, it SHALL NOT cover content or controls a person needs, in light, dark or at the largest text size. The last row of a screen or sheet SHALL be able to scroll clear of it. A control that does not follow the screen's safe area, and every context menu item, SHALL stay fully readable.

#### Scenario: Reconcile search field
- **GIVEN** the line showing on Reconcile step 2
- **WHEN** the search field is at the bottom of the sheet
- **THEN** the line and the field's text are both fully readable, and the field takes taps

#### Scenario: The last row of a sheet
- **GIVEN** the line showing over the Categorize sheet
- **WHEN** the person scrolls to the end of the list
- **THEN** the last row, such as "Internet", sits clear of the line

#### Scenario: A context menu from a low row
- **GIVEN** the line showing
- **WHEN** the person long-presses a row near the bottom of the screen
- **THEN** no item of the menu is under the line

### Requirement: The storage status line keeps its place
On iPhone the line SHALL sit above the tab bar and below the Undo bar, and rest above the keyboard without covering the field being edited, within "The storage status line fits above the keyboard". It SHALL return above the tab bar after a sheet closes, hide while an alert or confirmation shows, and take no touches.

#### Scenario: With the Undo bar
- **GIVEN** a write that shows both the line and the Undo bar
- **WHEN** the screen shows them
- **THEN** the line is above the tab bar and the Undo bar is above the line, with neither covered

#### Scenario: Editing with the keyboard up
- **GIVEN** the line showing
- **WHEN** the person edits a budget amount
- **THEN** the line is above the keyboard, or moves to the top if it would cover the field

#### Scenario: After a sheet closes
- **GIVEN** the line showing over a sheet
- **WHEN** the sheet closes
- **THEN** the line is back above the tab bar

#### Scenario: An alert or confirmation
- **GIVEN** the line showing
- **WHEN** an alert or the delete confirmation appears
- **THEN** the line is hidden until it closes

### Requirement: The storage status line fits above the keyboard
While the keyboard is up, with A the height from the top safe area, or from below a showing notice strip, to the keyboard, and H the line's height with its 8 pt margins: the full text SHALL show if its H is at most A ÷ 3. Otherwise the short form SHALL show on one line, never truncated: "Still saving…" for the not-stored state, and "Saving…" as is. If that H is still over A ÷ 3, the line SHALL hide and give back its space. When the keyboard goes, the full text and place return, unanimated.

#### Scenario: Room for the full text
- **GIVEN** the not-stored state and a keyboard leaving A at least 3 × the full text's H
- **WHEN** the line shows
- **THEN** it reads "Still saving to this device. Keep the app open."

#### Scenario: The short form
- **GIVEN** the full text's H over A ÷ 3, but the short form's H at most A ÷ 3
- **WHEN** the line shows
- **THEN** it reads "Still saving…" on one line, untruncated

#### Scenario: Hidden
- **GIVEN** an iPhone 16e at the largest text size, editing on Reconcile step 1, where even the short form's H is over A ÷ 3
- **WHEN** the keyboard is up
- **THEN** the line is hidden and its space given back, and it returns in full when the keyboard goes

#### Scenario: Below a notice strip
- **GIVEN** the restart or failure notice showing in the strip at the top, and the keyboard up
- **WHEN** the line is placed
- **THEN** A is measured from below the strip, and the line never covers the strip or its OK or Reload button

### Requirement: The storage status line's VoiceOver announcements
The not-stored announcement SHALL fire once when that state begins, whatever the line shows; full, short and hidden switches announce nothing, and the label is always the full sentence. When the "Still saving to this device. Keep the app open." state clears, VoiceOver SHALL announce "Saved to this device." once, only if the not-stored state was announced, whether the line was full, short or hidden, and never during an alert. Turning the guard on announces nothing for storage completion.

#### Scenario: Short form under VoiceOver
- **GIVEN** the line showing "Still saving…" with the keyboard up
- **WHEN** VoiceOver reads it
- **THEN** it reads "Still saving to this device. Keep the app open.", and the switch made no announcement

#### Scenario: Stored after a slow write
- **GIVEN** the not-stored state shown and announced
- **WHEN** the write is stored and no alert is showing
- **THEN** VoiceOver announces "Saved to this device." once

#### Scenario: Hidden, then stored
- **GIVEN** the not-stored state announced while the line was hidden above the keyboard
- **WHEN** the write is stored and no alert is showing
- **THEN** VoiceOver announces "Saved to this device." once

#### Scenario: A quick write
- **GIVEN** a write stored while only "Saving…" showed, so nothing was announced
- **WHEN** it is stored
- **THEN** nothing is announced

### Requirement: A restart with unconfirmed writes tells the person
If a restart leaves a write "may not have been saved" and no failure notice is showing, Swift SHALL show, with OK and in place of the reload notice, "The app restarted. Some recent changes may not have been saved. Check them, and make again any that are missing." This text SHALL appear nowhere else. A failure notice's restart form SHALL take priority.

#### Scenario: A pending write at a restart
- **GIVEN** a write showing "Still saving to this device. Keep the app open." and no failure notice
- **WHEN** the page restarts on its own
- **THEN** the line clears, this notice shows, no reload notice shows, and OK dismisses it

### Requirement: The native Accounts offline status is constant
On native Accounts, the offline status SHALL always read "Offline", whether or not a write is pending or "may not have been saved", and whether the storage status line is on or off. It SHALL promise nothing about saving or syncing and SHALL NOT change with writes, so the rows below it do not move. Only the storage status line and the restart and failure notices SHALL describe saving.

#### Scenario: A write while offline
- **GIVEN** native Accounts offline, at any text size
- **WHEN** a write starts and finishes
- **THEN** the status reads "Offline" throughout, and the rows below it do not move

#### Scenario: Line on, slow storage
- **GIVEN** the line on, the app offline, and a write that returned `stored: false`
- **WHEN** the screen shows
- **THEN** the status reads "Offline", and the line reads "Still saving to this device. Keep the app open."

#### Scenario: Line off in Release
- **GIVEN** a Release build with the line off, the app offline, and a write pending
- **WHEN** the screen shows
- **THEN** the status reads "Offline"

#### Scenario: After a restart
- **GIVEN** the app offline and a write that "may not have been saved"
- **WHEN** the screen shows
- **THEN** the status reads "Offline", and the restart notice describes the write

### Requirement: Any storage failure latches and is shown app-wide
With the storage guard on, any failed IndexedDB write of the open budget, from any source (bridge write, web-screen edit or sync), SHALL set a failed latch. The patched storage SHALL write nothing more, the page SHALL send a `storage-failed` event with `lastStoredFlushAt` (when the last write that stored was flushed), and Swift SHALL show a persistent app-level notice, whichever screen is showing, until the person reloads or, after a restart, taps OK.

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
With the storage guard on, the engine SHALL send local changes to the sync server only after `whenPersisted` resolves for the changes it reads to send, waiting at most `native-persist-wait-ms`; on expiry it SHALL send nothing and follow "A held sync never reports success". It SHALL send nothing while the failed latch is set, until reload. So a change that was refused or not stored is on neither the device nor the server, and making it again cannot create a duplicate.

#### Scenario: Refused, then made again
- **GIVEN** a transaction added just before a storage failure, refused as not stored
- **WHEN** the person reloads and adds it again
- **THEN** after the next sync the transaction is there once

#### Scenario: Hung storage
- **GIVEN** an IndexedDB write that never settles
- **WHEN** a sync runs
- **THEN** it stops waiting after `native-persist-wait-ms`, sends nothing, and schedules a retry

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

#### Scenario: Storage failure
- **GIVEN** a write that fails, not with a quota error
- **WHEN** the notice shows
- **THEN** it reads "Changes can't be saved on this device right now. Reload the app. Changes made after <time> weren't saved and need to be made again.", with Reload

#### Scenario: Device full
- **GIVEN** a write that fails with a quota error
- **WHEN** the notice shows
- **THEN** it reads "This device is full, so changes can't be saved. Free up some space, then reload the app. Changes made after <time> weren't saved and need to be made again. Saved changes can't sync until there's space."

### Requirement: The device-full notice with no time
When a quota failure comes with no cut-off time, the failure notice SHALL read "This device is full, so changes can't be saved. Free up some space, then reload the app. Changes made since you opened the app weren't saved and need to be made again. Saved changes can't sync until there's space."

#### Scenario: Device full, nothing stored this session
- **GIVEN** the app opened and its first write failed with a quota error
- **WHEN** the notice shows
- **THEN** it reads "This device is full, so changes can't be saved. Free up some space, then reload the app. Changes made since you opened the app weren't saved and need to be made again. Saved changes can't sync until there's space."

### Requirement: Storage notices keep their button until used
The storage notices SHALL show in the app's notice strip, announced to VoiceOver once, and SHALL NOT hide on their own or after a touch. The restart notices and the closed-budget notice SHALL carry OK, which ends that notice only. The failure notice SHALL carry Reload, which reloads the page, and no OK or Dismiss; it stays until Reload or a restart. Unlike the reload notice, none of them hides after 15 seconds.

#### Scenario: OK ends the restart notice
- **GIVEN** the restart notice showing
- **WHEN** the person taps OK
- **THEN** that notice goes, and any other notice is unchanged

#### Scenario: The failure notice stays
- **GIVEN** the failure notice showing
- **WHEN** 15 seconds pass and the person keeps working
- **THEN** it is still showing, with Reload and no way to dismiss it

#### Scenario: The closed-budget notice
- **GIVEN** the closed-budget notice showing
- **WHEN** the person taps OK
- **THEN** it goes

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

### Requirement: The restart notice asks the person to check
If the page restarts on its own while the failure notice shows, on iPhone or Mac, Swift SHALL replace it, with OK and no Reload, by "The app restarted. Changes made after <A> may not have been saved. Check them, and make again any that are missing." With no cut-off, it SHALL read "The app restarted. Changes made since you opened the app may not have been saved. Check them, and make again any that are missing." Copy SHALL NOT say "page".

#### Scenario: Restart with a cut-off time
- **GIVEN** the failure notice showing a cut-off of 3:42:10 PM
- **WHEN** the page's process dies and the page reloads on its own
- **THEN** the notice reads "The app restarted. Changes made after 3:42:10 PM may not have been saved. Check them, and make again any that are missing.", and OK dismisses it

#### Scenario: Restart with nothing stored
- **GIVEN** the failure notice showing with nothing stored since the app opened
- **WHEN** the page reloads on its own
- **THEN** the notice reads "The app restarted. Changes made since you opened the app may not have been saved. Check them, and make again any that are missing."

#### Scenario: The person reloads
- **GIVEN** the failure notice showing, with no restart notice waiting for OK
- **WHEN** the person taps Reload
- **THEN** the notice closes and no restart notice shows

### Requirement: A restart keeps the device-full reason
Swift SHALL hold the latest failure's quota reason, because a restart clears the engine's. If it was a quota failure, the restart notice SHALL read "The app restarted, and this device is out of space. Free up some space. Changes made after <A> may not have been saved. Check them, and make again any that are missing." With no cut-off, "Changes made since you opened the app" SHALL replace "Changes made after <A>".

#### Scenario: Restart while the device is full
- **GIVEN** the device-full notice showing a cut-off of 3:42:10 PM
- **WHEN** the page reloads on its own
- **THEN** the notice reads "The app restarted, and this device is out of space. Free up some space. Changes made after 3:42:10 PM may not have been saved. Check them, and make again any that are missing."

#### Scenario: The engine has forgotten the reason
- **GIVEN** a quota failure, then a restart after which `native/storage-state` reports no quota failure
- **WHEN** the restart notice shows
- **THEN** it still says the device is out of space

### Requirement: The failure notice outranks the reload notice
The failure notice SHALL replace a showing reload notice (sc-5220) at once. No reload notice SHALL appear over or beside the failure notice or its restart form, however many times the page restarts. After the person dismisses them, later automatic reloads SHALL show the reload notice as usual.

#### Scenario: Failure while the reload notice shows
- **GIVEN** the reload notice showing
- **WHEN** a storage failure is reported
- **THEN** the failure notice replaces it at once

#### Scenario: Repeated restarts
- **GIVEN** the restart notice showing 3:42:10 PM
- **WHEN** the page restarts again
- **THEN** the same notice and time stay, and no reload notice shows

#### Scenario: After OK
- **GIVEN** the person tapped OK
- **WHEN** the page later reloads on its own
- **THEN** the reload notice shows

### Requirement: The restart notice keeps the earliest cut-off
Swift SHALL hold the earliest cut-off until OK on a restart notice. A failure while one is held SHALL show the failure notice with that failure's own cut-off, because it says changes are lost, and the next page load SHALL bring back the restart notice with the earliest. A failure with nothing stored since a later page load SHALL use that load's time, truncated; "since you opened the app" SHALL apply only on the app's first load.

#### Scenario: A later failure
- **GIVEN** the restart notice held at 3:42:10 PM, a write stored at 3:50:00 PM, and a failure with cut-off 3:50:00 PM
- **WHEN** the failure is reported
- **THEN** the failure notice says changes made after 3:50:00 PM weren't saved, and after a reload the restart notice says 3:42:10 PM

#### Scenario: Stored before a restart, nothing since
- **GIVEN** writes stored before a restart at 4:00:30 PM with no notice showing, and nothing stored since
- **WHEN** the next write fails
- **THEN** the failure notice says changes made after 4:00:30 PM, never "since you opened the app"

### Requirement: A held sync never reports success
When sync's storage wait expires, the engine SHALL NOT emit sync success. It SHALL end the round with sync error `storage-slow` and schedule a retry after the usual sync delay, until storage finishes or fails. No new notice or alert SHALL show. The native sync status line SHALL read "Waiting for this device to finish saving" through the retries, and return to normal when the wait clears. `sync.pending` stays true.

#### Scenario: Storage still writing
- **GIVEN** a write still unfinished when the wait expires
- **WHEN** the sync round ends
- **THEN** no success event is sent, nothing was sent to the server, no alert shows, the status line reads "Waiting for this device to finish saving", and a retry is scheduled

#### Scenario: Storage finishes
- **GIVEN** a held sync
- **WHEN** the write completes and the retry runs
- **THEN** the changes are sent, sync reports success and the status line returns to normal

#### Scenario: Opening a budget during a held sync
- **GIVEN** a budget's initial sync whose storage wait expires
- **WHEN** the sync ends with `storage-slow`
- **THEN** the budget opens with no download error, a retry is scheduled, `sync.pending` stays true and nothing says synced

#### Scenario: A retry does not flicker
- **GIVEN** a held sync whose retry is also held
- **WHEN** the retry runs
- **THEN** the status line keeps the waiting text and never shows "Syncing…" or "Sync failed" for it

### Requirement: The storage guard is for the native shells
The latch, write refusal, sync gate, held-sync reporting and storage notices SHALL stay off until a native page bridge turns on the storage guard, a one-way engine switch set when the bridge installs in a shell that has opted in. Browsers never set it. With it off, the patched storage SHALL fail as stock absurd-sql does: no latch, no dropped queue, unseen quota rejections, and `onFallbackFailure` only for the safety check.

#### Scenario: A browser after a failed write
- **GIVEN** a fallback-mode browser, with no native bridge, whose write fails with a quota error
- **WHEN** the next sync runs
- **THEN** sync runs as today, with no storage wait or storage notice, and the next locked write fails the safety check and shows today's one-tab message

#### Scenario: The native shell
- **GIVEN** the native bridge has turned the guard on in the iPhone or Mac app
- **WHEN** a sync runs
- **THEN** the guard is on, and sync sends only stored changes

#### Scenario: Another tab
- **GIVEN** a browser write refused because another tab changed the file
- **WHEN** the failure is reported
- **THEN** `fallback-write-error` fires and the existing one-tab message shows

### Requirement: The storage guard is turned on per shell
Each native shell SHALL opt in to the storage guard separately, by telling its page bridge as it starts, for example with a flag in its init payload. The bridge SHALL turn the guard on only for a shell that opted in. A shell that has not SHALL behave as stock: no latch, sync gate, storage notices or "Saved" gating, and its client SHALL treat every write as stored at once. The iPhone opts in with the guard-on PR; the Mac stays stock until its own opt-in.

#### Scenario: The iPhone has opted in
- **GIVEN** the iPhone app with the guard-on PR merged
- **WHEN** its page bridge installs
- **THEN** the guard is on, and writes wait for storage before "Saved"

#### Scenario: The Mac has not opted in
- **GIVEN** the Mac app before its opt-in PR
- **WHEN** a write is made
- **THEN** the client returns it as stored at once, "Saved" shows as today, sync runs as today, and no storage notice shows

### Requirement: A closed budget's failed write is reported
A failed write in a file with no open handles SHALL NOT set the latch. The engine SHALL send `storage-close-failed` once for that file, and the app SHALL show, with OK, "Some recent changes to the budget you closed weren't saved. Open it and make them again." A showing failure notice SHALL keep priority, and this notice follows it.

#### Scenario: The last flush fails after closing
- **GIVEN** a budget closed while its last write is pending
- **WHEN** that write fails
- **THEN** the notice shows once, and writes to the budget now open are not refused

### Requirement: Limits report their floor
`native/settings` SHALL return each limit's `floor` with its value, default and ceiling; a limit without its own floor reports 1. The Limits screens SHALL accept only values from floor to ceiling, and `native/settings-save` SHALL refuse any other.

#### Scenario: The storage wait
- **WHEN** native code reads `native/settings`
- **THEN** `native-persist-wait-ms` has floor 100 and ceiling 4000, and the Limits screen won't accept 50

### Requirement: The storage wait is a limit
`native-persist-wait-ms` SHALL be in the limits registry with the name "Saving: wait for device storage", the help line "How long a change waits to be stored on this device before the app says it isn't yet", default 2000, floor 100 and ceiling 4000, under the 5 s bridge deadline. A value outside floor to ceiling SHALL read as the default.

#### Scenario: Changed in Settings
- **GIVEN** the Limits screen lists this limit
- **WHEN** the user sets "Saving: wait for device storage" to 3000 in Settings > Advanced > Limits
- **THEN** the next `native/persisted` call waits up to 3 s

#### Scenario: Before the Limits screen lists it
- **GIVEN** the Limits screen has not shipped this limit and nothing has set it
- **WHEN** `native/persisted` runs
- **THEN** the wait is the default 2000 ms

#### Scenario: Bad values
- **WHEN** the stored value is "50", "5000" or "abc"
- **THEN** the wait is 2000 ms

### Requirement: The shells flush storage before backgrounding or quitting
The iPhone app SHALL call `native/persisted` when it moves to the background, in a background task with an expiration handler that ends it at once. The task SHALL end at the earliest of the answer, the wait, or expiry. The Mac app SHALL call it before quitting (replying later to terminate) and before closing its window, and best-effort before sleep, which it cannot delay. Each flush SHALL wait for every file's pending writes, including a just-closed budget's.

#### Scenario: iPhone to the background
- **GIVEN** a change just made in a web screen inside the iPhone app
- **WHEN** the person swipes to the home screen
- **THEN** the app holds a background task until storage finishes, the wait passes or iOS expires it, whichever is first

#### Scenario: A budget just closed
- **GIVEN** a budget closed with its last write still pending
- **WHEN** the app moves to the background or quits
- **THEN** the flush waits for that write too, up to the wait

#### Scenario: Mac quit
- **GIVEN** a change still being stored
- **WHEN** the person quits the Mac app
- **THEN** the app quits after storage finishes, or after the wait at the latest

### Requirement: Durable platforms do not wait for storage
The barrier SHALL resolve at once wherever writes are already durable when they return: absurd-sql's SharedArrayBuffer mode (the web app from our server), Electron and the API (better-sqlite3), so those platforms and MCP behave and perform as before.

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
The Mac test suite SHALL time a one-row categorize through the client end to end (the `native/storage-state` check, the write and `native/persisted`) against the bare write, 30 runs each, and SHALL fail when the three together add more than 50 ms to the median or 250 ms to the p95. A real iPhone's median and p95, and the largest test budget's write time, SHALL be recorded before the first TestFlight build with this change.

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

### Requirement: Page dialogs are handled by the shell
A page `alert()`, `confirm()` or `prompt()` holds all of the page's JavaScript, and with it every bridge call, until it is answered. The iPhone and Mac shells SHALL show each one above every native screen, the notice strip and the storage line, with the buttons OK and Cancel, and SHALL give the page the person's answer.

#### Scenario: An alert over a native screen
- **GIVEN** a native screen covers the page
- **WHEN** the page calls `alert()`
- **THEN** the alert shows above the native screen, and after OK the page goes on and the bridge answers

#### Scenario: Confirm and prompt
- **WHEN** the page calls `confirm()` or `prompt()` and the person answers
- **THEN** the page gets `true` for OK and `false` for Cancel, or the typed text and `null` for Cancel

#### Scenario: The Mac no longer drops dialogs
- **WHEN** the page calls `alert()`, `confirm()` or `prompt()` in the Mac app
- **THEN** it shows as a sheet on the window, where WebKit used to drop it and the page went on with nothing shown

### Requirement: A page dialog is always answered
The shells SHALL answer every page dialog exactly once. A dialog on screen SHALL wait for the person with no time limit. The page SHALL get Cancel's answer (an alert closed, `confirm` false, `prompt` null) only when the dialog can't show within five tries a second apart, or when the page goes away, in which case the dialog also leaves the screen.

#### Scenario: A dialog waits for the person
- **WHEN** a prompt shows and the person types in it for several minutes
- **THEN** it stays on screen with what they typed, and the page gets it when they tap OK

#### Scenario: No window to show it
- **WHEN** a dialog can't show (the app isn't active, or the Mac window is hidden or has a sheet)
- **THEN** the shell tries again every second, and after five tries the page gets Cancel's answer

#### Scenario: The page goes away
- **WHEN** a dialog shows and its page reloads or navigates away, its process ends, or its web view is released
- **THEN** the dialog leaves the screen and the page gets Cancel's answer, once

### Requirement: A page that keeps asking is answered for the person
When a page asks for a fourth dialog within ten seconds of its first three, the shell SHALL answer it with Cancel without showing it, so a page calling `alert()` in a loop can't hold the person or cover the notice strip's Reload. The count SHALL start again when the page goes away.

#### Scenario: A page loops alert()
- **WHEN** a page shows three dialogs in ten seconds and asks for a fourth
- **THEN** the fourth gets Cancel's answer and nothing shows, and the person can tap Reload

### Requirement: Another page's dialog names its host
A dialog from the app's own page SHALL show the page's message only. A dialog from any other page, such as a sign-in provider's, SHALL be headed with that page's host, or "Another page" when it has none, so it can't pass for the app's own. A dialog SHALL show the page's text as plain text, cut to 1,000 characters with an ellipsis.

#### Scenario: A sign-in provider's dialog
- **WHEN** a sign-in provider's page in the web view calls `alert()`
- **THEN** the dialog is headed with the provider's host, above its message

#### Scenario: A sandboxed frame's dialog
- **WHEN** a frame with no host calls `alert()`
- **THEN** the dialog is headed "Another page"

#### Scenario: A very long message
- **WHEN** a page's message is longer than 1,000 characters
- **THEN** the dialog shows the first 999 and an ellipsis, and its buttons stay on screen

### Requirement: Only the app's own page reaches Capacitor's prompt calls
On iPhone, Capacitor reads its cookie and HTTP settings through `prompt()` with JSON of four types. The shell SHALL pass those to Capacitor only from the app's own page as the main frame; from any other page or frame it SHALL answer `null` and show nothing.

#### Scenario: Another frame sends Capacitor's cookie call
- **WHEN** a frame that isn't the app's main page calls `prompt('{"type":"CapacitorCookies.get"}')`
- **THEN** it gets `null`, no dialog shows, and Capacitor's handler is not called
