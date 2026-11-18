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

### Requirement: Native-screen switches are per device and default on
On iPhone, Settings › Native screens SHALL list one switch per shipped native screen. A switch SHALL read on when never set, and SHALL keep an explicit off across updates. The native and web sections SHALL write the same per-device value. Each screen's own change SHALL decide when its switch reads on while unset; Settings SHALL set no default.

#### Scenario: Never set
- **GIVEN** a shipped native screen whose switch was never set
- **THEN** its row shows on

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
On iPhone, Settings › Sync SHALL show the server's address (or that the budget is local only) and whether the budget is end-to-end encrypted, read-only. Sign out SHALL ask first, then end the session as the web user menu does, and remove the device's session, encryption keys and last-opened budget. The native-screen switches SHALL be kept.

#### Scenario: Sign out
- **GIVEN** a signed-in person with an encrypted budget
- **WHEN** they tap Sign out and confirm
- **THEN** the sign-in screen shows, the encryption key must be entered again after signing in, and the native-screen switches are unchanged

#### Scenario: Cancel
- **WHEN** the person taps Sign out and then Cancel
- **THEN** they stay signed in and nothing changes

### Requirement: Settings without a native screen open the web section
On iPhone, a setting with no native screen yet SHALL be a row that opens its existing web section and returns to native Settings when closed. The rows SHALL be exactly: language, switch budget, change server, encryption, users, bank sync providers, business calendars, experimental features, export, reset cache, repair transactions and notifications. Backups SHALL not appear on iPhone.

#### Scenario: Language
- **WHEN** the person taps Language
- **THEN** the web language setting opens, and closing it returns to native Settings

#### Scenario: No backups on iPhone
- **THEN** native Settings on iPhone shows no Backups row

### Requirement: Web screens in the app follow the system appearance
Inside the iPhone app, the native screens and the web screens SHALL follow the system's light or dark appearance, and web Settings SHALL not offer a theme there. The theme stored for browsers and the desktop app SHALL not change.

#### Scenario: Dark system
- **GIVEN** the iPhone set to dark appearance and a stored web theme of "light"
- **WHEN** a web screen shows inside the app
- **THEN** it is dark, and the stored theme is still "light"

### Requirement: Limits can be changed and reset
Settings › Advanced › Limits SHALL list every configurable limit with its value and default, natively on iPhone and in web Settings on desktop and phone web. A value SHALL be a whole number from 1 to the limit's ceiling; Reset SHALL return it to the default. The change SHALL apply to the next read or write on every device and through MCP.

#### Scenario: Raising the register page size
- **WHEN** the person sets "Register page size" to 120 on iPhone
- **THEN** the next register page on iPhone and the web shows the same value in Limits, and a register page holds 120 rows

#### Scenario: Over the ceiling
- **WHEN** the person types 900 for a limit whose ceiling is 200
- **THEN** the field says the most is 200 and nothing is stored

#### Scenario: Reset
- **WHEN** the person taps Reset on a changed limit
- **THEN** it shows its default again

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
