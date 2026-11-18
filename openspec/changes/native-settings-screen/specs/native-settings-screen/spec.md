## ADDED Requirements

### Requirement: The native Settings tab is behind its own switch
The iPhone app SHALL show the native Settings tab only while `NativeScreen.settings` is on; otherwise the tab SHALL be the web Settings screen as before. Once the screen has passed its hands-on review, an unset switch SHALL read as on. Both the native and the web Native screens sections SHALL offer the Settings row, so the person can always switch back.

#### Scenario: Switch off
- **GIVEN** `NativeScreen.settings` stored as false
- **WHEN** the person opens the Settings tab
- **THEN** the web Settings screen shows, with a Native Settings row in Native screens

#### Scenario: Turning it off natively
- **GIVEN** the native Settings tab is showing
- **WHEN** the person turns off the Settings row in Native screens
- **THEN** the tab shows the web Settings screen at once

### Requirement: Native-screen switches show each screen's own default
On iPhone, Settings › Native screens SHALL list one switch per shipped native screen. A row SHALL show the stored value, or while never set that screen's own default, which the screen's own change decides; Settings SHALL set no default. An explicit off SHALL be kept across updates. The native and web sections SHALL write the same per-device value.

#### Scenario: Never set, default on
- **GIVEN** the Reconcile switch was never set, and Reconcile defaults on
- **THEN** its row shows on

#### Scenario: Never set, default still off
- **GIVEN** the Accounts switch was never set, on a release before Accounts defaults on
- **THEN** its row shows off, and the Accounts tab is the web screen

#### Scenario: Explicit off survives an update
- **GIVEN** the person turned the Budget switch off
- **WHEN** the app updates to a release where Budget defaults on
- **THEN** the Budget row still shows off and the web Budget screen shows

#### Scenario: Native and web agree
- **WHEN** the person turns Accounts off in native Settings and then opens web Settings with native Settings switched off
- **THEN** the web Accounts toggle shows off

### Requirement: Budget preferences are stored as the web stores them
On iPhone, changing date format, number format, hide decimals, first day of week, budget type, learn categories, upcoming length, or (while the currency feature is on) currency and its symbol options in native Settings SHALL store the same values the web Settings screen stores for the same choice, synced to every device, as one undoable change.

#### Scenario: Date format
- **WHEN** the person picks the date format `dd.MM.yyyy` natively
- **THEN** the synced `dateFormat` preference equals what web Settings stores for that choice, and web screens show dates in it

#### Scenario: Budget type asks first
- **WHEN** the person changes the budget type to tracking
- **THEN** a confirmation explains the change, and only on Confirm is the type stored and the budget recalculated

#### Scenario: Undo
- **WHEN** the person changes the number format and taps Undo in the toast
- **THEN** the earlier number format is restored

### Requirement: Settings shows the fork's versions
On iPhone, Settings › About SHALL show the fork's client version as the web shows it (for example `v26.10.1-alpha.37`), the iPhone app's version and build, and the server's version. When the server cannot be reached, About SHALL say so in words and offer Retry; the rest of Settings SHALL still work.

#### Scenario: Versions shown
- **GIVEN** the app runs client 26.10.1-alpha.37 against a server reporting 26.10.1-alpha.37
- **THEN** About shows both, and the app's version and build

#### Scenario: Server offline
- **GIVEN** the server does not answer
- **THEN** About reads "Server unreachable" with Retry, and the client version still shows

### Requirement: Sync shows the server, encryption and sign-out
On iPhone, Settings › Sync SHALL show the server's address (or that the budget is local only) and whether the budget is end-to-end encrypted, read-only. Sign out SHALL ask first, then end the session as the web user menu does, and remove the device's session, encryption keys and last-opened budget. The switches and the local budget copy SHALL stay; native code SHALL keep no other copy of budget data.

#### Scenario: Sign out
- **GIVEN** a signed-in person with an encrypted budget
- **WHEN** they tap Sign out and confirm
- **THEN** the sign-in screen shows, the encryption key must be entered again after signing in, and the native-screen switches are unchanged

#### Scenario: Cancel
- **WHEN** the person taps Sign out and then Cancel
- **THEN** they stay signed in and nothing changes

### Requirement: Sign-out warns about unsynced changes
On iPhone, when changes on the device have not synced, the sign-out confirmation SHALL say that signing out now loses them and SHALL offer Sync now, which syncs and asks again. When nothing is pending, the confirmation SHALL not mention it.

#### Scenario: Pending changes
- **GIVEN** a transaction added offline that has not synced
- **WHEN** the person taps Sign out
- **THEN** the confirmation warns that unsynced changes will be lost and offers Sync now

#### Scenario: Sync now
- **WHEN** the person taps Sync now and the sync succeeds
- **THEN** the confirmation shows again without the warning

#### Scenario: Nothing pending
- **GIVEN** everything has synced
- **THEN** the confirmation has no unsynced-changes warning

### Requirement: Settings without a native screen open the web section
On iPhone, a setting with no native screen yet SHALL be a row that opens its existing web section and returns to native Settings when closed. The rows SHALL be exactly: language, switch budget, change server (or set up sync when local only), encryption, users, bank sync providers, business calendars, experimental features, export, reset cache, repair transactions and notifications. Backups SHALL not appear on iPhone.

#### Scenario: Language
- **WHEN** the person taps Language in the This iPhone section
- **THEN** the web language setting opens, and closing it returns to native Settings

### Requirement: Per-device settings are grouped under This iPhone
On iPhone, Settings SHALL show a This iPhone section holding the native-screen switches and the Language row, which hands off to the web and says it opens in the web view. Language SHALL not appear under Features.

#### Scenario: Section contents
- **WHEN** the person opens Settings
- **THEN** the This iPhone section lists the native-screen switches and Language, and Features does not list Language

### Requirement: A local-only budget shows that it is not syncing
On iPhone, for a budget with no sync server, Settings › Sync SHALL show "Server: Local only, not syncing", say the budget is stored only on this iPhone, and offer Set up sync, which opens the web sync setup. It SHALL show no Sign out and no Encryption row. About SHALL show the server as not syncing, with no Retry.

#### Scenario: Sync section
- **GIVEN** a budget that does not sync
- **WHEN** the person opens Settings
- **THEN** Sync shows "Local only, not syncing" and Set up sync, and no Sign out or Encryption row

#### Scenario: Set up sync
- **WHEN** the person taps Set up sync
- **THEN** the web sync setup opens, and closing it returns to native Settings

#### Scenario: About
- **GIVEN** a budget that does not sync
- **THEN** About shows the server as not syncing, with no Retry, and the client and app versions

### Requirement: Settings shows a loading state
On iPhone, until the first settings read answers, the Settings tab SHALL show its sections on the real layout with placeholder values and no spinner, and VoiceOver SHALL read that settings are loading. The native-screen switches SHALL show at once. If the read fails, the tab SHALL show an error with Retry.

#### Scenario: First load
- **GIVEN** the engine has not answered the settings read
- **WHEN** the person opens Settings
- **THEN** the sections show placeholders, the switches show their values, and VoiceOver reads "Loading settings"

#### Scenario: Read fails
- **WHEN** the first settings read fails
- **THEN** the tab shows an error with Retry, and Retry reads again

#### Scenario: No backups on iPhone
- **THEN** native Settings on iPhone shows no Backups row

### Requirement: Web screens in the app follow the system appearance
Inside the iPhone app, the native screens and the web screens SHALL follow the system's light or dark appearance, and web Settings SHALL not offer a theme there. The theme stored for browsers and the desktop app SHALL not change.

#### Scenario: Dark system
- **GIVEN** the iPhone set to dark appearance and a stored web theme of "light"
- **WHEN** a web screen shows inside the app
- **THEN** it is dark, and the stored theme is still "light"

### Requirement: Limits can be changed and reset
Settings › Advanced › Limits SHALL list every configurable limit with its value and default, natively on iPhone and in web Settings on desktop and phone web. A value SHALL be a whole number from 1 to the limit's ceiling; Reset SHALL return it to the default. The change SHALL apply to the next read or write on every device and in a running MCP server.

#### Scenario: Raising the register page size
- **WHEN** the person sets "Register: rows per page" to 120 on iPhone
- **THEN** the next register page on iPhone and the web shows the same value in Limits, and a register page holds 120 rows

#### Scenario: Over the ceiling
- **WHEN** the person types 900 for a limit whose ceiling is 200
- **THEN** the field says the most is 200 and nothing is stored

#### Scenario: Reset
- **WHEN** the person taps Reset on a changed limit
- **THEN** it shows its default again

### Requirement: Every limit explains itself
Each limit SHALL show a plain-words name, one line saying what it protects, its default and its ceiling. A limit without a name or help line SHALL still be listed under its id, and a test SHALL fail the build when a registry limit lacks either.

#### Scenario: Register: rows per page
- **WHEN** the person opens Limits
- **THEN** "Register: rows per page" reads "Keeps the register fast on a large account", "Default 50", "Up to 200"

#### Scenario: A new limit without text
- **GIVEN** a limit is added to the registry with no name or help line
- **THEN** the build's label test fails

### Requirement: Operator limits are not settings
Limits that bound the MCP server itself (grant rows, cells, deletes, reconcile, confirm and scope settings; the server's audit, response, statement-age and clock-skew limits) SHALL never be in the Limits list or the settings registry, and SHALL stay set by the operator.

#### Scenario: Not listed
- **WHEN** the person opens Limits
- **THEN** no MCP row, cell, delete, audit or statement limit is listed

#### Scenario: Not savable
- **WHEN** native code saves the key `max_rows` or `statement-max-age-hours`
- **THEN** the call fails with `[native:invalid-setting]` and nothing changes

### Requirement: Keyboard, VoiceOver and Dynamic Type
On iPhone, Settings SHALL be fully usable with a hardware keyboard (Tab and arrows move, Space toggles, Return opens, Esc goes back, ⌘, selects the Settings tab). VoiceOver SHALL read each row's label, value and state, and say when a row opens the web view. Up to AX5, values SHALL wrap below labels and never truncate.

#### Scenario: Keyboard toggle
- **GIVEN** a hardware keyboard
- **WHEN** the person presses ⌘, then moves to the Accounts switch and presses Space
- **THEN** the Accounts switch changes

#### Scenario: VoiceOver on a hand-off row
- **WHEN** VoiceOver focuses the Language row
- **THEN** it reads "Language, opens in the web view"

#### Scenario: AX5 versions
- **GIVEN** the text size is AX5
- **THEN** the full client and server versions are visible in About
